import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "events" })
export class EventEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ name: "tenant_id", type: "uuid" })
  tenantId: string;

  @Column({ name: "event_type" })
  eventType: string;

  @Column({ type: "jsonb", default: {} })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
