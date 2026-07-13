import { DataSource, QueryRunner } from "typeorm";

/**
 * Runs `work` inside a transaction with `app.current_tenant` set via
 * set_config(..., true) (transaction-scoped, equivalent to SET LOCAL). Every
 * RLS-protected query must go through this so the tenant scope is set before
 * any query touches the tables, and reverts automatically at commit/rollback.
 */
export async function withTenantContext<T>(
  dataSource: DataSource,
  tenantId: string,
  work: (queryRunner: QueryRunner) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const result = await work(queryRunner);
    await queryRunner.commitTransaction();
    return result;
  } catch (err) {
    await queryRunner.rollbackTransaction();
    throw err;
  } finally {
    await queryRunner.release();
  }
}
