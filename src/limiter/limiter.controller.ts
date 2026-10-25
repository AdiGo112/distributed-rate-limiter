import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LimiterService } from './limiter.service.js';
import { CheckDto } from './dto/check.dto.js';

@Controller('v1')
export class LimiterController {
  constructor(private readonly svc: LimiterService) {}

  @Post('check')
  @HttpCode(200)
  async check(
    @Body() dto: CheckDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.check(dto);
    res.setHeader('X-RateLimit-Remaining', r.remaining);
    if (!r.allowed) {
      res.status(429);
      // at least 1 s, so a fail-closed denial (retryAfterMs 0) doesn't invite instant retries
      res.setHeader(
        'Retry-After',
        Math.max(1, Math.ceil(r.retryAfterMs / 1000)),
      );
    }
    return r;
  }
}
