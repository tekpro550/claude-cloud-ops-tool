import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Upgrades the alert engine from "monitor status transitions only" to a real
 * metric-rule engine: rule_kind picks between the existing status behavior
 * (unchanged, and the default so every existing row keeps working exactly as
 * before) and two new kinds --
 *  - threshold: alert when `metric` has satisfied `comparator threshold` for
 *    the last `for_consecutive` checks.
 *  - anomaly: alert when the latest value deviates from its trailing
 *    baseline by more than `anomaly_sensitivity` standard deviations.
 * One alert_rules row per monitor still holds (see the existing
 * alert_rules_monitor_id_key unique constraint) -- rule_kind changes what
 * that one row means, rather than adding a parallel table.
 */
export class ExtendAlertRules1784420000000 implements MigrationInterface {
  name = 'ExtendAlertRules1784420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE alert_rules
        ADD COLUMN rule_kind text NOT NULL DEFAULT 'status'
          CHECK (rule_kind IN ('status', 'threshold', 'anomaly')),
        ADD COLUMN metric text,
        ADD COLUMN comparator text CHECK (comparator IN ('gt', 'gte', 'lt', 'lte')),
        ADD COLUMN threshold double precision,
        ADD COLUMN for_consecutive int NOT NULL DEFAULT 1,
        ADD COLUMN anomaly_sensitivity double precision;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE alert_rules
        DROP COLUMN IF EXISTS rule_kind,
        DROP COLUMN IF EXISTS metric,
        DROP COLUMN IF EXISTS comparator,
        DROP COLUMN IF EXISTS threshold,
        DROP COLUMN IF EXISTS for_consecutive,
        DROP COLUMN IF EXISTS anomaly_sensitivity;
    `);
  }
}
