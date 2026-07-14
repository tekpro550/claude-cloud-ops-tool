import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { AppModule } from "../../../app.module";
import { GroupsService } from "../groups.service";
import { AgentsService } from "../agents.service";
import { TicketTypesService } from "../ticket-types.service";
import { SlaPoliciesService } from "../sla-policies.service";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Admin CRUD verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "cloud_ops_tool",
    user: process.env.DB_MIGRATOR_USER ?? "postgres",
    password: process.env.DB_MIGRATOR_PASSWORD ?? "postgres",
  });
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `admin-crud-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(`INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`, [
    "Admin CRUD Verify",
    slug,
  ]);
  const {
    rows: [contact],
  } = await migrator.query(`INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`, [
    tenant.id,
    "Test Contact",
    "test@example.com",
  ]);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const groups = app.get(GroupsService);
  const agents = app.get(AgentsService);
  const ticketTypes = app.get(TicketTypesService);
  const slaPolicies = app.get(SlaPoliciesService);

  try {
    // ---- Groups ----
    const group = await groups.create(tenant.id, { name: "Cloud Support", description: "Azure/AWS tickets" });
    assert(group.name === "Cloud Support", "group created");
    const groupList1 = await groups.list(tenant.id);
    assert(groupList1.length === 1, "group appears in list()");
    const groupUpdated = await groups.update(tenant.id, group.id, { description: "Updated description" });
    assert(groupUpdated.description === "Updated description", "group description updated");
    assert(groupUpdated.name === "Cloud Support", "unspecified fields untouched on group update");

    let groupNotFound: any = null;
    try {
      await groups.update(tenant.id, "00000000-0000-4000-8000-000000000000", { name: "x" });
    } catch (err) {
      groupNotFound = err;
    }
    assert(groupNotFound?.status === 404, "updating a nonexistent group returns 404");

    // ---- SLA policies ----
    const slaPolicy = await slaPolicies.create(tenant.id, {
      name: "Standard",
      firstResponseTargetMinutes: 60,
      resolutionTargetMinutes: 480,
    });
    assert(slaPolicy.first_response_target_minutes === 60, "SLA policy created with correct target minutes");
    const slaUpdated = await slaPolicies.update(tenant.id, slaPolicy.id, { resolutionTargetMinutes: 600 });
    assert(slaUpdated.resolution_target_minutes === 600, "SLA policy resolution target updated");

    // ---- Ticket types ----
    const ticketType = await ticketTypes.create(tenant.id, {
      name: "Cloud Support - Azure",
      defaultGroupId: group.id,
      defaultSlaPolicyId: slaPolicy.id,
    });
    assert(ticketType.default_group_id === group.id, "ticket type created with defaultGroupId resolved");
    assert(ticketType.default_sla_policy_id === slaPolicy.id, "ticket type created with defaultSlaPolicyId resolved");

    let badGroupRef: any = null;
    try {
      await ticketTypes.create(tenant.id, { name: "Bad type", defaultGroupId: "00000000-0000-4000-8000-000000000000" });
    } catch (err) {
      badGroupRef = err;
    }
    assert(badGroupRef?.status === 400, "creating a ticket type with a nonexistent defaultGroupId is rejected (400)");

    // ---- Agents ----
    const agent = await agents.create(tenant.id, { name: "New Agent", email: "new-agent@example.com", groupIds: [group.id] });
    assert(agent.name === "New Agent" && agent.email === "new-agent@example.com", "agent created (user + agent row)");
    assert(agent.is_active === true, "a new agent starts active");
    const agentList = await agents.list(tenant.id);
    assert(agentList.length === 1, "agent appears in list() joined with user name/email");

    let duplicateEmail: any = null;
    try {
      await agents.create(tenant.id, { name: "Duplicate", email: "new-agent@example.com" });
    } catch (err) {
      duplicateEmail = err;
    }
    assert(duplicateEmail?.status === 400, "creating an agent with an already-used email is rejected (400)");

    const agentDeactivated = await agents.update(tenant.id, agent.id, { isActive: false });
    assert(agentDeactivated.is_active === false, "agent can be deactivated");
    const agentListAfterDeactivate = await agents.list(tenant.id);
    assert(
      agentListAfterDeactivate.find((a: any) => a.id === agent.id)?.is_active === false,
      "deactivated agent still appears in list() (not hard-deleted)",
    );

    // ---- Deletion guarded by FK usage ----
    const { rows: ticketRows } = await migrator.query(
      `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, group_id, source) VALUES ($1, 1, $2, $3, $4, 'api') RETURNING id`,
      [tenant.id, "Uses the group", contact.id, group.id],
    );
    let groupDeleteBlocked: any = null;
    try {
      await groups.remove(tenant.id, group.id);
    } catch (err) {
      groupDeleteBlocked = err;
    }
    assert(groupDeleteBlocked?.status === 400, "deleting a group still referenced by a ticket is rejected (400), not a raw DB error");

    await migrator.query(`DELETE FROM tickets WHERE id = $1`, [ticketRows[0].id]);
    await groups.remove(tenant.id, group.id);
    const groupListAfterDelete = await groups.list(tenant.id);
    assert(groupListAfterDelete.length === 0, "group deletion succeeds once nothing references it");

    console.log("\nAll admin CRUD checks passed.");
  } finally {
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_number_counters WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_types WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM sla_policies WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM groups WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
