import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { EmailIntakeService } from './email-intake/email-intake.service';
import { OverdueSweepService } from './sla/overdue-sweep.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Ticketing Service boundary from section 4 of the architecture plan
 * (Module 1) — see docs/Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md.
 */
@Module({
  imports: [PlatformModule, EventBusModule, NotificationsModule],
  controllers: [TicketsController, ReferenceDataController],
  providers: [
    TicketsService,
    EmailIntakeService,
    OverdueSweepService,
    ReferenceDataService,
  ],
})
export class TicketingModule {}
