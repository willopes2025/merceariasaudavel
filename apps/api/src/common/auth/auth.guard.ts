import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ForbiddenError } from '../errors/domain-error';
import { setContext } from '../tenancy/request-context';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './decorators';
import { PermissionResolver } from './permission-resolver';
import type { TokenPayload } from './token-payload';

/**
 * Porta de entrada única: valida o token, monta o contexto da requisição e
 * checa permissão. Nenhuma rota lê a organização do cliente.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Optional() private readonly resolver?: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.verify(request);

    // A permissão do token é a do login; a que vale é a de agora. Tirar um
    // acesso ou desativar a pessoa passa a valer em até um minuto.
    let permissions = payload.permissions ?? [];
    let storeIds = payload.storeIds ?? [];
    if (this.resolver) {
      const now = await this.resolver.resolve(payload.sub, payload.tenantId);
      if (!now.active) throw new UnauthorizedException('Usuário desativado');
      permissions = now.permissions;
      storeIds = now.storeIds;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (required?.length && !permissions.includes('*')) {
      const missing = required.filter((p) => !permissions.includes(p));
      if (missing.length) throw new ForbiddenError('PERMISSION_DENIED', 'Permissão insuficiente', { missing });
    }

    setContext({ tenantId: payload.tenantId, userId: payload.sub, storeIds, permissions });
    return true;
  }

  private async verify(request: Request): Promise<TokenPayload> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Token ausente');
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    // Token do app do cliente não abre rota da equipe.
    if (payload.kind || !Array.isArray(payload.permissions)) throw new UnauthorizedException('Token inválido ou expirado');
    return payload;
  }
}
