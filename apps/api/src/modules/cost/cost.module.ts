import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';

/**
 * Cost/FinOps Service boundary from section 4 of the architecture plan
 * (Module 3). Empty until that module's build starts — see section 7.3 of
 * docs/Cloud-Ops-Tool-Architecture-Plan.md.
 */
@Module({
  imports: [PlatformModule],
})
export class CostModule {}
