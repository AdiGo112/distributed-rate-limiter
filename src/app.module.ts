import { Module } from '@nestjs/common';
import { LimiterModule } from './limiter/limiter.module.js';

@Module({
  imports: [LimiterModule],
})
export class AppModule {}
