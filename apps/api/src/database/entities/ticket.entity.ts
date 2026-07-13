import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TicketStatus = 'new' | 'open' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketSource =
  'email' | 'web_form' | 'whatsapp' | 'chat' | 'api' | 'alert';

@Entity({ name: 'tickets' })
export class TicketEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'ticket_number', type: 'int' })
  ticketNumber: number;

  @Column({ name: 'legacy_ticket_number', type: 'int', nullable: true })
  legacyTicketNumber: number | null;

  @Column()
  subject: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ name: 'ticket_type_id', type: 'uuid', nullable: true })
  ticketTypeId: string | null;

  @Column({
    type: 'enum',
    enum: ['new', 'open', 'pending', 'resolved', 'closed'],
    enumName: 'ticket_status_enum',
    default: 'new',
  })
  status: TicketStatus;

  @Column({
    type: 'enum',
    enum: ['low', 'medium', 'high', 'urgent'],
    enumName: 'ticket_priority_enum',
    default: 'medium',
  })
  priority: TicketPriority;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ name: 'agent_id', type: 'uuid', nullable: true })
  agentId: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  /** FK added in Sprint 2, once sla_policies exists. */
  @Column({ name: 'sla_policy_id', type: 'uuid', nullable: true })
  slaPolicyId: string | null;

  @Column({
    name: 'first_response_due_at',
    type: 'timestamptz',
    nullable: true,
  })
  firstResponseDueAt: Date | null;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date | null;

  @Column({ name: 'resolution_due_at', type: 'timestamptz', nullable: true })
  resolutionDueAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({
    type: 'enum',
    enum: ['email', 'web_form', 'whatsapp', 'chat', 'api', 'alert'],
    enumName: 'ticket_source_enum',
  })
  source: TicketSource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
