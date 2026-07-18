import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { GroupsService } from '../../groups.service';
import { TicketsService } from '../../tickets.service';
import { AgentSkillsService } from '../agent-skills.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assignment verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

async function seedAgent(
  migrator: Client,
  tenantId: string,
  groupId: string,
  email: string,
): Promise<string> {
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenantId, email, email],
  );
  const {
    rows: [agent],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id, group_ids) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, user.id, [groupId]],
  );
  return agent.id as string;
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `assignment-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Assignment Verify', slug],
  );
  const tenantId = tenant.id as string;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const groups = app.get(GroupsService);
  const tickets = app.get(TicketsService);
  const agentSkills = app.get(AgentSkillsService);

  let contactCounter = 0;
  const newTicket = (groupId: string, requiredSkill?: string) => {
    contactCounter += 1;
    return tickets.create(tenantId, {
      subject: `Ticket ${contactCounter}`,
      contact: {
        name: `Contact ${contactCounter}`,
        email: `c${contactCounter}-${slug}@example.com`,
      },
      source: 'api',
      groupId,
      requiredSkill,
    });
  };

  try {
    // ---- manual (default): no auto-assign ----
    const manualGroup = await groups.create(tenantId, { name: 'Manual Group' });
    await seedAgent(
      migrator,
      tenantId,
      manualGroup.id,
      `manual-a-${slug}@example.com`,
    );
    const manualTicket = await newTicket(manualGroup.id);
    assert(
      manualTicket.agent_id === null,
      'manual strategy leaves new tickets unassigned',
    );

    // ---- round_robin: cycles through agents in id order, persists position ----
    const rrGroup = await groups.create(tenantId, {
      name: 'Round Robin Group',
      assignmentStrategy: 'round_robin',
    });
    const rrAgentIds: string[] = [];
    for (const tag of ['b', 'a', 'c']) {
      rrAgentIds.push(
        await seedAgent(
          migrator,
          tenantId,
          rrGroup.id,
          `rr-${tag}-${slug}@example.com`,
        ),
      );
    }
    rrAgentIds.sort();
    const rrAssignees: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t = await newTicket(rrGroup.id);
      rrAssignees.push(t.agent_id);
    }
    assert(
      rrAssignees[0] === rrAgentIds[0] &&
        rrAssignees[1] === rrAgentIds[1] &&
        rrAssignees[2] === rrAgentIds[2] &&
        rrAssignees[3] === rrAgentIds[0],
      'round_robin cycles through agents in id order and wraps around',
    );

    // ---- load_based: picks the least-loaded agent, respects the cap ----
    const lbGroup = await groups.create(tenantId, {
      name: 'Load Based Group',
      assignmentStrategy: 'load_based',
      maxOpenTicketsPerAgent: 2,
    });
    const lbAgentX = await seedAgent(
      migrator,
      tenantId,
      lbGroup.id,
      `lb-x-${slug}@example.com`,
    );
    const lbAgentY = await seedAgent(
      migrator,
      tenantId,
      lbGroup.id,
      `lb-y-${slug}@example.com`,
    );
    // Both agents start at 0 open tickets; the first pick is a tie broken by
    // id, and the second pick must go to whichever agent it didn't pick.
    const firstTicket = await newTicket(lbGroup.id);
    const firstPick = firstTicket.agent_id;
    const other = firstPick === lbAgentX ? lbAgentY : lbAgentX;
    const secondPick = await newTicket(lbGroup.id);
    assert(
      secondPick.agent_id === other,
      'load_based picks the least-loaded agent next (the one not just assigned)',
    );
    // Both agents now at 1 open ticket each; cap is 2, so two more tickets fill them to the cap.
    await newTicket(lbGroup.id);
    await newTicket(lbGroup.id);
    // Every agent in the group is now at the cap (2) -- the next ticket must go unassigned.
    const overCapTicket = await newTicket(lbGroup.id);
    assert(
      overCapTicket.agent_id === null,
      'load_based leaves a ticket unassigned once every agent is at max_open_tickets_per_agent',
    );

    // ---- skill_based: only agents with the matching skill are eligible ----
    const skGroup = await groups.create(tenantId, {
      name: 'Skill Based Group',
      assignmentStrategy: 'skill_based',
    });
    const skilledAgent = await seedAgent(
      migrator,
      tenantId,
      skGroup.id,
      `sk-skilled-${slug}@example.com`,
    );
    await seedAgent(
      migrator,
      tenantId,
      skGroup.id,
      `sk-unskilled-${slug}@example.com`,
    );
    await agentSkills.add(tenantId, {
      agentId: skilledAgent,
      skill: 'billing',
    });

    const skilledTicket = await newTicket(skGroup.id, 'billing');
    assert(
      skilledTicket.agent_id === skilledAgent,
      'skill_based only assigns to an agent with the matching skill',
    );

    const noMatchTicket = await newTicket(skGroup.id, 'networking');
    assert(
      noMatchTicket.agent_id === null,
      'skill_based leaves a ticket unassigned when no agent has the required skill',
    );

    const noSkillRequestedTicket = await newTicket(skGroup.id);
    assert(
      noSkillRequestedTicket.agent_id === null,
      'skill_based leaves a ticket unassigned when the ticket specifies no required skill',
    );

    // ---- an explicit agentId always wins over auto-assignment ----
    const pinnedTicket = await tickets.create(tenantId, {
      subject: 'Pinned ticket',
      contact: { name: 'Pinned Contact', email: `pinned-${slug}@example.com` },
      source: 'api',
      groupId: rrGroup.id,
      agentId: rrAgentIds[2],
    });
    assert(
      pinnedTicket.agent_id === rrAgentIds[2],
      'an explicit agentId is never overridden by the group auto-assignment strategy',
    );

    // ---- RLS: skills and cursors are tenant-isolated ----
    const {
      rows: [otherTenant],
    } = await migrator.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
      ['Assignment Verify Other', `${slug}-other`],
    );
    const otherSkills = await agentSkills.list(otherTenant.id as string);
    assert(
      otherSkills.length === 0,
      'RLS hides one tenant’s agent skills from another',
    );

    console.log('\nAll auto-assignment checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE slug LIKE $1`, [
      `${slug}%`,
    ]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
