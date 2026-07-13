import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ResourceType =
  'server' | 'cloud_account' | 'service' | 'website' | 'database' | 'other';

@Entity({ name: 'resources' })
export class ResourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({
    name: 'resource_type',
    type: 'enum',
    enum: [
      'server',
      'cloud_account',
      'service',
      'website',
      'database',
      'other',
    ],
    enumName: 'resource_type_enum',
  })
  resourceType: ResourceType;

  @Column({ name: 'group_name', nullable: true })
  groupName: string | null;

  @Column({ name: 'external_ref', type: 'jsonb', default: {} })
  externalRef: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  tags: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
