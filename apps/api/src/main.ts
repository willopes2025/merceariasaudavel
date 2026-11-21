import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

/** BigInt do Postgres precisa virar número no JSON — senão o Express estoura. */
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(this: bigint) {
  return Number(this);
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false, rawBody: true });

  // Atrás do Caddy: IP e protocolo do cliente vêm dos cabeçalhos X-Forwarded-*.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

  app.setGlobalPrefix('v1');
  app.enableCors({ origin: true, credentials: true });

  const swagger = new DocumentBuilder()
    .setTitle('Mercearia API')
    .setDescription('Sistema da Mercearia Saudável: loja, clube e app do cliente')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, swagger));

  serveWebApps(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Mercearia API em http://localhost:${port}/v1 (docs em /v1/docs)`);
}

/**
 * Em produção o mesmo processo serve a API e o sistema web (como no Soul ERP):
 *
 *   /        → sistema (apps/web)
 *   /v1      → API
 *
 * O app da loja (PWA) entra em /loja numa fase seguinte, do mesmo jeito.
 */
function serveWebApps(app: NestExpressApplication): void {
  const publicDir = process.env.PUBLIC_DIR ?? join(__dirname, '..', 'public');
  if (!existsSync(publicDir)) return;

  const bundles = [
    { dir: join(publicDir, 'loja'), prefix: '/loja' },
    { dir: join(publicDir, 'web'), prefix: '/' },
  ].filter((bundle) => existsSync(bundle.dir));

  for (const bundle of bundles) {
    app.useStaticAssets(bundle.dir, { prefix: bundle.prefix, index: false });
  }

  // Rota de aplicação (/configuracoes/lojas) devolve o index.html — sem isso,
  // recarregar a página daria 404.
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' || request.path.startsWith('/v1')) return next();
    const bundle = bundles.find((candidate) => (candidate.prefix === '/' ? true : request.path.startsWith(candidate.prefix)));
    if (!bundle) return next();
    return response.sendFile(join(bundle.dir, 'index.html'));
  });

  new Logger('Bootstrap').log(`Servindo ${bundles.length} aplicação(ões) web de ${publicDir}`);
}

void bootstrap();
