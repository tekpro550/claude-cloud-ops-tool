import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Ticketing Service boundary from section 4 of the architecture plan
 * (Module 1) — see docs/Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md.
 */
@Module({
  imports: [PlatformModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketingModule {}
