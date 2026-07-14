import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  EventEntity,
  NotificationEntity,
  ResourceEntity,
  TenantEntity,
  UserEntity,
  GroupEntity,
  AgentEntity,
  CompanyEntity,
  ContactEntity,
  TicketTypeEntity,
  TicketEntity,
  TicketMessageEntity,
  SlaPolicyEntity,
  AutomationRuleEntity,
  CannedResponseEntity,
  TicketTodoEntity,
  TicketTimeLogEntity,
} from './entities';

/**
 * The app always connects as DB_APP_USER, never as the migrator/owner role.
 * That's what makes the RLS policies from the foundation migration bind: the
 * runtime connection has no way to bypass them, regardless of what the
 * application code does or forgets to do.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_APP_USER', 'app_user'),
        password: config.get<string>(
          'DB_APP_PASSWORD',
          'app_user_dev_password',
        ),
        database: config.get<string>('DB_NAME', 'cloud_ops_tool'),
        entities: [
          TenantEntity,
          UserEntity,
          ResourceEntity,
          EventEntity,
          NotificationEntity,
          GroupEntity,
          AgentEntity,
          CompanyEntity,
          ContactEntity,
          TicketTypeEntity,
          TicketEntity,
          TicketMessageEntity,
          SlaPolicyEntity,
          AutomationRuleEntity,
          CannedResponseEntity,
          TicketTodoEntity,
          TicketTimeLogEntity,
        ],
        synchronize: false,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
