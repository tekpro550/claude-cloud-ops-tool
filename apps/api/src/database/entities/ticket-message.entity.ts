import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type TicketMessageType = 'reply' | 'note' | 'forward';
export type TicketMessageAuthorType = 'agent' | 'contact' | 'system';

@Entity({ name: 'ticket_messages' })
export class TicketMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Index()
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({
    type: 'enum',
    enum: ['reply', 'note', 'forward'],
    enumName: 'ticket_message_type_enum',
  })
  type: TicketMessageType;

  @Column({
    name: 'author_type',
    type: 'enum',
    enum: ['agent', 'contact', 'system'],
    enumName: 'ticket_message_author_type_enum',
  })
  authorType: TicketMessageAuthorType;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'text', array: true, default: '{}' })
  cc: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
