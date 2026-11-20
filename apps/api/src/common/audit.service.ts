import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import type { RequestContext } from './tenancy/request-context';

/** Registro de quem mudou o quê. A tabela só aceita inclusão (ver migração de RLS). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    ctx: RequestContext,
    action: string,
    entity: string,
    entityId: string | null,
    data?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { tenantId: ctx.tenantId, userId: ctx.userId, action, entity, entityId, data },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
