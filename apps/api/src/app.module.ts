import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { CostModule } from './modules/cost/cost.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { PlatformModule } from './modules/platform/platform.module';
import { TicketingModule } from './modules/ticketing/ticketing.module';

/**
 * The four service boundaries of the modular monolith from section 4 of the
 * architecture plan: Platform (auth/tenant/notif/audit), Ticketing,
 * Monitoring, Cost/FinOps. Only Platform has real code so far — the other
 * three are intentionally empty scaffolding until their respective modules
 * are built.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PlatformModule,
    AiModule,
    TicketingModule,
    MonitoringModule,
    CostModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
