import { randomUUID } from "crypto";
import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import Redis from "ioredis";
import { DataSource } from "typeorm";
import { withTenantContext } from "../database/context/tenant-context";
import { EVENTS_STREAM_KEY, REDIS_CLIENT } from "./redis.constants";
import { DomainEventMessage, PublishEventInput } from "./event-bus.types";

type XReadGroupResult = Array<[stream: string, entries: Array<[id: string, fields: string[]]>]> | null;

/**
 * Thin wrapper over a single Redis Stream (`cloud-ops-tool:events`) shared by
 * all modules, matching the architecture plan's "Redis Streams initially"
 * event bus. Every publish also writes to the `events` Postgres table (see
 * the Sprint 0.2 migration) as the durable audit trail — the stream is for
 * delivery, the table is the record that survives a consumer or Redis outage.
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly consumerClients: Redis[] = [];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async publish(event: PublishEventInput): Promise<DomainEventMessage> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    await withTenantContext(this.dataSource, event.tenantId, async (queryRunner) => {
      await queryRunner.query(
        `INSERT INTO events (id, tenant_id, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [id, event.tenantId, event.eventType, JSON.stringify(event.payload), createdAt],
      );
    });

    await this.redis.xadd(
      EVENTS_STREAM_KEY,
      "*",
      "id",
      id,
      "tenantId",
      event.tenantId,
      "eventType",
      event.eventType,
      "payload",
      JSON.stringify(event.payload),
      "createdAt",
      createdAt,
    );

    return { id, tenantId: event.tenantId, eventType: event.eventType, payload: event.payload, createdAt };
  }

  /**
   * Starts a blocking consumer loop under `groupName` on its own connection
   * (XREADGROUP blocks the connection it runs on, so it can't share the
   * publisher's client) and calls `handler` for each message, XACKing only
   * after `handler` resolves.
   */
  async consume(
    groupName: string,
    handler: (event: DomainEventMessage) => Promise<void>,
    consumerName: string = `${groupName}-${process.pid}`,
  ): Promise<void> {
    const client = this.redis.duplicate();
    this.consumerClients.push(client);

    try {
      await client.xgroup("CREATE", EVENTS_STREAM_KEY, groupName, "0", "MKSTREAM");
    } catch (err) {
      if (!(err as Error).message?.includes("BUSYGROUP")) {
        throw err;
      }
    }

    void this.loop(client, groupName, consumerName, handler);
  }

  private async loop(
    client: Redis,
    groupName: string,
    consumerName: string,
    handler: (event: DomainEventMessage) => Promise<void>,
  ): Promise<void> {
    while (client.status !== "end") {
      let result: XReadGroupResult;
      try {
        result = (await client.xreadgroup(
          "GROUP",
          groupName,
          consumerName,
          "COUNT",
          10,
          "BLOCK",
          5000,
          "STREAMS",
          EVENTS_STREAM_KEY,
          ">",
        )) as XReadGroupResult;
      } catch (err) {
        const status: string = client.status;
        if (status === "end") return;
        this.logger.error(`consumer ${consumerName} read error: ${(err as Error).message}`);
        continue;
      }

      if (!result) continue;

      const [[, messages]] = result;
      for (const [messageId, fields] of messages) {
        const event = this.parseFields(fields);
        try {
          await handler(event);
          await client.xack(EVENTS_STREAM_KEY, groupName, messageId);
        } catch (err) {
          this.logger.error(`handler failed for message ${messageId}: ${(err as Error).message}`);
        }
      }
    }
  }

  private parseFields(fields: string[]): DomainEventMessage {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      map[fields[i]] = fields[i + 1];
    }
    return {
      id: map.id,
      tenantId: map.tenantId,
      eventType: map.eventType,
      payload: JSON.parse(map.payload),
      createdAt: map.createdAt,
    };
  }

  async onModuleDestroy(): Promise<void> {
    for (const client of this.consumerClients) {
      client.disconnect();
    }
    this.redis.disconnect();
  }
}
