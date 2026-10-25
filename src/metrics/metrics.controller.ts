import { Controller, Get, Header } from '@nestjs/common';
import { register } from './metrics.js';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}
