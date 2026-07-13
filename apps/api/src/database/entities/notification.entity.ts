import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type NotificationChannel = "email" | "whatsapp" | "voice" | "in_app";
export type NotificationStatus = "queued" | "sent" | "failed";

@Entity({ name: "notifications" })
export class NotificationEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ name: "tenant_id", type: "uuid" })
  tenantId: string;

  @Column({ type: "enum", enum: ["email", "whatsapp", "voice", "in_app"], enumName: "notification_channel_enum" })
  channel: NotificationChannel;

  @Column()
  recipient: string;

  @Column({ name: "template_name" })
  templateName: string;

  @Column({ type: "jsonb", default: {} })
  payload: Record<string, unknown>;

  @Column({ type: "enum", enum: ["queued", "sent", "failed"], enumName: "notification_status_enum", default: "queued" })
  status: NotificationStatus;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @Column({ name: "sent_at", type: "timestamptz", nullable: true })
  sentAt: Date | null;
}
