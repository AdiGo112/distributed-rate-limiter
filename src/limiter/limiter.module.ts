import { Module } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { LimiterController } from './limiter.controller.js';
import { LimiterService } from './limiter.service.js';

@Module({
  controllers: [LimiterController],
  providers: [RedisService, LimiterService],
})
export class LimiterModule {}
