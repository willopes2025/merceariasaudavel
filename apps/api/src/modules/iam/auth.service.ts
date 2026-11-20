import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { LoginResult, SessionUser } from '@mercearia/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { LoginThrottle } from '../../common/auth/login-throttle';
import type { TokenPayload } from '../../common/auth/token-payload';
import type { RequestContext } from '../../common/tenancy/request-context';
import { AccessService } from './access.service';

@Injectable()
export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const wait = this.throttle.lockedFor(email);
    if (wait > 0) {
      throw new DomainError('LOGIN_LOCKED', `Muitas tentativas com este e-mail. Tente de novo em ${wait} min.`, { minutes: wait }, 429);
    }

    // O e-mail é único por organização, não no sistema: a mesma pessoa pode ter
    // acesso em mais de uma. A senha decide qual delas é (como no Soul ERP).
    const candidates = await this.prisma.appUser.findMany({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, status: 'active', tenant: { status: 'active' } },
      orderBy: { createdAt: 'asc' },
    });
    let user: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (await argon2.verify(candidate.passwordHash, password)) {
        user = candidate;
        break;
      }
    }
    if (!user) {
      this.throttle.fail(email);
      // Mesma resposta para e-mail inexistente e senha errada: não entregamos pista.
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }
    this.throttle.succeed(email);

    const access = await this.access.load(user.id, user.tenantId);
    await this.prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const payload: TokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      storeIds: access.storeIds,
      permissions: access.permissions,
    };
    return { accessToken: await this.jwt.signAsync(payload), user: await this.sessionUser(user.id, user.tenantId) };
  }

  me(ctx: RequestContext): Promise<SessionUser> {
    return this.sessionUser(ctx.userId, ctx.tenantId);
  }

  private async sessionUser(userId: string, tenantId: string): Promise<SessionUser> {
    const user = await this.prisma.appUser.findFirst({
      where: { id: userId, tenantId },
      include: { tenant: { select: { name: true } } },
    });
    if (!user) throw new NotFoundError('usuário', userId);
    const access = await this.access.load(userId, tenantId);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      permissions: access.permissions,
      storeIds: access.storeIds,
    };
  }
}
