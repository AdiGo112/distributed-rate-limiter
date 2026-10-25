import { Module } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { LimiterService } from './limiter.service.js';

@Module({
  providers: [RedisService, LimiterService],
})
export class LimiterModule {}
