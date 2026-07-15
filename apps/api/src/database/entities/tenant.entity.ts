import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PlanTier = 'internal' | 'starter' | 'growth' | 'scale';
export type CostRateDisplay = 'list_price' | 'negotiated';

@Entity({ name: 'tenants' })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  slug: string;

  @Column({
    name: 'plan_tier',
    type: 'enum',
    enum: ['internal', 'starter', 'growth', 'scale'],
    enumName: 'plan_tier_enum',
  })
  planTier: PlanTier;

  @Column({ name: 'financial_year_start_month', type: 'int', default: 4 })
  financialYearStartMonth: number;

  @Column({
    name: 'cost_rate_display',
    type: 'enum',
    enum: ['list_price', 'negotiated'],
    enumName: 'cost_rate_display_enum',
    default: 'list_price',
  })
  costRateDisplay: CostRateDisplay;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
