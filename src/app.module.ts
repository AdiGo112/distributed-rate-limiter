import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { LimiterModule } from './limiter/limiter.module.js';

@Module({
  imports: [LimiterModule],
  // registered here (not in main.ts) so tests that build AppModule get validation too
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
