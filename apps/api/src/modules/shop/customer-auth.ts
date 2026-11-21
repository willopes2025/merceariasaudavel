import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CustomerTokenPayload } from '../../common/auth/token-payload';

/** Quem está usando o app: a cliente e a organização vêm do token, nunca do corpo. */
export interface CustomerSession {
  tenantId: string;
  customerId: string;
  mustChange: boolean;
}

type WithCustomer = Request & { customer?: CustomerSession };

/**
 * Porta das rotas do app do cliente. Aceita só token de cliente (o da equipe
 * não serve aqui, e o de cliente não serve nas rotas da equipe). Confere a cada
 * chamada se o acesso continua valendo: trocar o PIN ou receber código novo no
 * balcão derruba os logins antigos; cadastro desativado perde o acesso.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WithCustomer>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Entre no app para continuar');
    let payload: CustomerTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<CustomerTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Sessão expirada: entre de novo');
    }
    if (payload.kind !== 'cliente' || typeof payload.v !== 'number') throw new UnauthorizedException('Sessão inválida');
    const access = await this.prisma.customerAccess.findFirst({
      where: { customerId: payload.sub, tenantId: payload.tenantId },
      select: { version: true, mustChange: true, customer: { select: { active: true } } },
    });
    if (!access || access.version !== payload.v || !access.customer.active) throw new UnauthorizedException('Sessão expirada: entre de novo');
    request.customer = { tenantId: payload.tenantId, customerId: payload.sub, mustChange: access.mustChange };
    return true;
  }
}

export const CurrentCustomer = createParamDecorator((_: unknown, context: ExecutionContext): CustomerSession => {
  const customer = context.switchToHttp().getRequest<WithCustomer>().customer;
  if (!customer) throw new UnauthorizedException('Entre no app para continuar');
  return customer;
});
