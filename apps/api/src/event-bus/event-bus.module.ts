import { Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { redisProvider } from './redis.provider';

@Module({
  providers: [redisProvider, EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
