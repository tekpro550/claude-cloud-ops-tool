import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';

/**
 * Monitoring Service boundary from section 4 of the architecture plan
 * (Module 2). Empty until that module's build starts — see section 7.2 of
 * docs/Cloud-Ops-Tool-Architecture-Plan.md.
 */
@Module({
  imports: [PlatformModule],
})
export class MonitoringModule {}
