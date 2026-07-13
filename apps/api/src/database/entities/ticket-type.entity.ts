import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'ticket_types' })
export class TicketTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ name: 'default_group_id', type: 'uuid', nullable: true })
  defaultGroupId: string | null;

  /** FK added in Sprint 2, once sla_policies exists. */
  @Column({ name: 'default_sla_policy_id', type: 'uuid', nullable: true })
  defaultSlaPolicyId: string | null;
}
