import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { PlatformModule } from '../platform/platform.module';
import { MonitorSchedulerService } from './monitor-scheduler.service';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';

/**
 * Monitoring Service boundary from section 4 of the architecture plan
 * (Module 2) — see docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md.
 */
@Module({
  imports: [PlatformModule, EventBusModule],
  controllers: [MonitorsController],
  providers: [MonitorsService, MonitorSchedulerService],
})
export class MonitoringModule {}
