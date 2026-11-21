import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { Public, RequiresPermission } from './decorators';
import { PermissionResolver } from './permission-resolver';
import { currentContext, runWithContextScope, type RequestContext } from '../tenancy/request-context';

const jwt = new JwtService({ secret: 'teste-com-mais-de-trinta-e-dois-caracteres' });

class Rotas {
  @Public()
  aberta() {}
  livre() {}
  @RequiresPermission('settings.manage')
  configurar() {}
}

class Resolver extends PermissionResolver {
  constructor(private readonly now: { active: boolean; permissions: string[]; storeIds: string[] }) {
    super();
  }
  async resolve() {
    return this.now;
  }
}

async function call(handler: keyof Rotas, token: string | null, resolver?: PermissionResolver) {
  const guard = new AuthGuard(jwt, new Reflector(), resolver);
  let ctx: RequestContext | undefined;
  const context = {
    getHandler: () => Rotas.prototype[handler],
    getClass: () => Rotas,
    switchToHttp: () => ({ getRequest: () => ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) }),
  } as unknown as ExecutionContext;
  const ok = await runWithContextScope(async () => {
    const result = await guard.canActivate(context);
    ctx = currentContext();
    return result;
  });
  return { ok, ctx };
}

const token = (permissions: string[], extra: Record<string, unknown> = {}) =>
  jwt.signAsync({ sub: 'u1', tenantId: 't1', storeIds: [], permissions, ...extra });

describe('AuthGuard', () => {
  it('rota pública não pede token', async () => {
    await expect(call('aberta', null)).resolves.toMatchObject({ ok: true });
  });

  it('sem token ou com token adulterado, recusa', async () => {
    await expect(call('livre', null)).rejects.toThrow('Token ausente');
    const t = await token([]);
    await expect(call('livre', `${t}x`)).rejects.toThrow('Token inválido');
  });

  it('token do app do cliente não abre rota da equipe', async () => {
    const t = await jwt.signAsync({ sub: 'c1', tenantId: 't1', kind: 'cliente', v: 1 });
    await expect(call('livre', t)).rejects.toThrow('Token inválido');
  });

  it('a organização do contexto vem do token', async () => {
    const { ctx } = await call('livre', await token([]));
    expect(ctx).toMatchObject({ tenantId: 't1', userId: 'u1' });
  });

  it('exige a permissão da rota; proprietário (*) passa', async () => {
    await expect(call('configurar', await token(['crm.inbox']))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(call('configurar', await token(['settings.manage']))).resolves.toMatchObject({ ok: true });
    await expect(call('configurar', await token(['*']))).resolves.toMatchObject({ ok: true });
  });

  it('vale a permissão de agora, não a do login', async () => {
    const t = await token(['*']);
    const rebaixado = new Resolver({ active: true, permissions: ['crm.inbox'], storeIds: ['loja-a'] });
    await expect(call('configurar', t, rebaixado)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const { ctx } = await call('livre', t, rebaixado);
    expect(ctx?.storeIds).toEqual(['loja-a']);
  });

  it('usuário desativado perde o acesso mesmo com token válido', async () => {
    const t = await token(['*']);
    await expect(call('livre', t, new Resolver({ active: false, permissions: [], storeIds: [] }))).rejects.toThrow('Usuário desativado');
  });
});
