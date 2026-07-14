import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AutomationTrigger = 'ticket_created' | 'ticket_updated';

export interface AutomationCondition {
  field:
    | 'status'
    | 'priority'
    | 'source'
    | 'subject'
    | 'ticket_type_id'
    | 'group_id';
  operator: 'equals' | 'contains';
  value: string;
}

export type AutomationAction =
  | { type: 'set_status'; value: string }
  | { type: 'set_priority'; value: string }
  | { type: 'set_group'; value: string }
  | { type: 'set_agent'; value: string }
  | { type: 'add_note'; value: string };

@Entity({ name: 'automation_rules' })
export class AutomationRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: ['ticket_created', 'ticket_updated'],
    enumName: 'automation_trigger_enum',
  })
  trigger: AutomationTrigger;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', default: '[]' })
  conditions: AutomationCondition[];

  @Column({ type: 'jsonb', default: '[]' })
  actions: AutomationAction[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
