import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'agents' })
export class AgentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'group_ids', type: 'uuid', array: true, default: '{}' })
  groupIds: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
