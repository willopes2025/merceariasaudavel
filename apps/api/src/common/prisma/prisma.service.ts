import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { isolationEnabled, withTenantIsolation } from './tenant-isolation';

/**
 * Cliente do banco. Com `DB_ISOLATION=on` (padrão em produção), toda operação
 * feita dentro de uma requisição autenticada passa pelo isolamento por
 * organização do PostgreSQL (ver `tenant-isolation.ts`).
 *
 * Usa o driver `pg` direto (cliente Prisma sem motor nativo): nada de binário
 * para baixar no build, e o pool de conexões fica sob nosso controle.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.DB_POOL_MAX ?? 10),
      }),
    });
    // O cliente estendido mantém os métodos desta classe (onModuleInit etc.).
    // Nesta fase cada requisição enxerga só a própria organização.
    return withTenantIsolation(this as never, async (ctx) => [ctx.tenantId]) as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Conectado ao PostgreSQL${isolationEnabled() ? ' · isolamento por organização ligado' : ''}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
