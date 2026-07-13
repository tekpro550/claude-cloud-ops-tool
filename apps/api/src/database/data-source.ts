import "dotenv/config";
import { DataSource } from "typeorm";
import { TenantEntity, UserEntity, ResourceEntity, EventEntity, NotificationEntity } from "./entities";

/**
 * Used by the TypeORM CLI (migration:run/revert/generate) and connects as the
 * migrator role, which owns the schema and is exempt from RLS. The NestJS
 * runtime connects separately as DB_APP_USER (see app.module.ts), which is
 * the role RLS policies actually restrict.
 */
export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_MIGRATOR_USER ?? "postgres",
  password: process.env.DB_MIGRATOR_PASSWORD ?? "postgres",
  database: process.env.DB_NAME ?? "cloud_ops_tool",
  entities: [TenantEntity, UserEntity, ResourceEntity, EventEntity, NotificationEntity],
  migrations: [__dirname + "/migrations/*.{ts,js}"],
  synchronize: false,
  // TypeORM auto-installs a UUID extension on connect because entities use
  // @PrimaryGeneratedColumn("uuid"). Force pgcrypto (trusted since PG13, so
  // no superuser needed) over the default uuid-ossp, even though the actual
  // schema below uses the built-in gen_random_uuid() and never touches it.
  uuidExtension: "pgcrypto",
});
