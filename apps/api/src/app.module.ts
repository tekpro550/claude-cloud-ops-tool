import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { DatabaseModule } from "./database/database.module";
import { EventBusModule } from "./event-bus/event-bus.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, EventBusModule, NotificationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
