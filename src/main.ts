import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // JSON lines, so `docker compose logs` output can be grepped or shipped to Loki/ELK as-is
    logger: new ConsoleLogger({
      json: process.env.LOG_FORMAT !== 'pretty',
      logLevels:
        process.env.LOG_LEVEL === 'debug'
          ? ['debug', 'log', 'warn', 'error', 'fatal']
          : ['log', 'warn', 'error', 'fatal'],
    }),
  });
  app.enableShutdownHooks(); // runs onModuleDestroy (closes Redis) on docker stop
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
