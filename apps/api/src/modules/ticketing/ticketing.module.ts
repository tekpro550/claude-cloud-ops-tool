import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';

/**
 * Ticketing Service boundary from section 4 of the architecture plan
 * (Module 1). Empty until Sprint 1 — see
 * docs/Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md.
 */
@Module({
  imports: [PlatformModule],
})
export class TicketingModule {}
