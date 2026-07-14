import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CompaniesService } from '../companies.service';
import { ContactsService } from '../contacts.service';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`CRM/activities verification FAILED: ${message}`);
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

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `crm-activities-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['CRM/Activities Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const companies = app.get(CompaniesService);
  const contacts = app.get(ContactsService);
  const tickets = app.get(TicketsService);

  try {
    // ---- Companies ----
    const company = await companies.create(tenant.id, {
      name: 'Acme Corp',
      domain: 'acme.example',
    });
    assert(company.name === 'Acme Corp', 'company created');
    const companyList1 = await companies.list(tenant.id);
    assert(companyList1.length === 1, 'company appears in list()');
    const companyUpdated = await companies.update(tenant.id, company.id, {
      domain: 'acme-updated.example',
    });
    assert(
      companyUpdated.domain === 'acme-updated.example',
      'company domain updated',
    );

    // ---- Contacts ----
    const contact = await contacts.create(tenant.id, {
      name: 'Jane Requester',
      email: 'jane@acme.example',
      companyId: company.id,
    });
    assert(
      contact.company_id === company.id,
      'contact created with companyId resolved',
    );
    const contactList = await contacts.list(tenant.id);
    assert(contactList.length === 1, 'contact appears in list()');
    const contactSearch = await contacts.list(tenant.id, 'jane');
    assert(
      contactSearch.length === 1,
      'searching contacts by partial name matches',
    );
    const contactSearchMiss = await contacts.list(tenant.id, 'nomatch');
    assert(
      contactSearchMiss.length === 0,
      'searching contacts with no match returns empty',
    );

    let badCompanyRef: any = null;
    try {
      await contacts.create(tenant.id, {
        name: 'Bad Contact',
        companyId: '00000000-0000-4000-8000-000000000000',
      });
    } catch (err) {
      badCompanyRef = err;
    }
    assert(
      badCompanyRef?.status === 400,
      'creating a contact with a nonexistent companyId is rejected (400)',
    );

    const contactUpdated = await contacts.update(tenant.id, contact.id, {
      phone: '555-0100',
    });
    assert(contactUpdated.phone === '555-0100', 'contact phone updated');

    // Deleting a company should not be blocked by its contacts (ON DELETE SET NULL).
    await companies.remove(tenant.id, company.id);
    const contactAfterCompanyDelete = await contacts.get(
      tenant.id,
      contact.id,
    );
    assert(
      contactAfterCompanyDelete.company_id === null,
      'deleting a company unlinks (not blocks) its contacts',
    );

    // ---- Ticket activity log ----
    const ticket = await tickets.create(tenant.id, {
      subject: 'VPN not connecting',
      contactId: contact.id,
      source: 'web_form',
    });
    const noActivityYet = await tickets.listActivities(tenant.id, ticket.id);
    assert(
      noActivityYet.length === 0,
      'a freshly created ticket has no activity rows yet',
    );

    await tickets.update(tenant.id, ticket.id, {
      status: 'open',
      priority: 'high',
    });
    const afterFirstUpdate = await tickets.listActivities(
      tenant.id,
      ticket.id,
    );
    assert(
      afterFirstUpdate.length === 2,
      `updating status+priority writes 2 activity rows (got ${afterFirstUpdate.length})`,
    );
    const statusActivity = afterFirstUpdate.find(
      (a: any) => a.field === 'status',
    );
    assert(
      statusActivity?.old_value === 'new' &&
        statusActivity?.new_value === 'open',
      'the status activity row records old_value/new_value correctly',
    );

    await tickets.update(tenant.id, ticket.id, { priority: 'high' });
    const afterNoopUpdate = await tickets.listActivities(
      tenant.id,
      ticket.id,
    );
    assert(
      afterNoopUpdate.length === 2,
      'setting a field to its current value does not add a redundant activity row',
    );

    await tickets.update(tenant.id, ticket.id, { platform: 'azure' });
    const afterPlatformChange = await tickets.listActivities(
      tenant.id,
      ticket.id,
    );
    assert(
      afterPlatformChange.length === 3 &&
        afterPlatformChange[2].field === 'platform' &&
        afterPlatformChange[2].new_value === 'azure',
      'changing platform is tracked as its own activity row',
    );

    let notFound: any = null;
    try {
      await tickets.listActivities(
        tenant.id,
        '00000000-0000-4000-8000-000000000000',
      );
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'listing activities for a nonexistent ticket returns 404',
    );

    console.log('\nAll CRM and activity log checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM companies WHERE tenant_id = $1`, [
      tenant.id,
    ]);
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
