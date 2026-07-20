import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformModule } from '../modules/platform/platform.module';
import {
  AI_COMPLETION_CLIENT,
  createCompletionClient,
} from './ai-completion.client';
import { AskController } from './ask/ask.controller';
import { AskService } from './ask/ask.service';
import { TenantAiSettingsController } from './tenant-ai-settings.controller';
import { TenantAiSettingsService } from './tenant-ai-settings.service';

/**
 * Global AI module: provides the process-wide completion client (built from
 * env vars) and TenantAiSettingsService to every other module without each
 * one having to import this module explicitly. The @Global() decorator makes
 * both exports available app-wide once AppModule imports AiModule once.
 */
@Global()
@Module({
  imports: [PlatformModule],
  controllers: [TenantAiSettingsController, AskController],
  providers: [
    TenantAiSettingsService,
    AskService,
    {
      provide: AI_COMPLETION_CLIENT,
      inject: [ConfigService],
      useFactory: createCompletionClient,
    },
  ],
  exports: [AI_COMPLETION_CLIENT, TenantAiSettingsService],
})
export class AiModule {}
