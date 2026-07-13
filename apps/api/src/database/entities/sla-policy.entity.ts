import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sla_policies' })
export class SlaPolicyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ name: 'first_response_target_minutes', type: 'int' })
  firstResponseTargetMinutes: number;

  @Column({ name: 'resolution_target_minutes', type: 'int' })
  resolutionTargetMinutes: number;

  @Column({ name: 'business_hours_only', default: false })
  businessHoursOnly: boolean;

  @Column({ name: 'escalation_rules', type: 'jsonb', default: {} })
  escalationRules: Record<string, unknown>;
}
