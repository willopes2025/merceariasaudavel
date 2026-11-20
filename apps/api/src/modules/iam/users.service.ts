import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { RoleRow, UserCreateInput, UserRow, UserUpdateInput } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { AccessService } from './access.service';

const OWNER = 'owner';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async roles(ctx: RequestContext): Promise<RoleRow[]> {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ tenantId: null }, { tenantId: ctx.tenantId }] },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({ code: r.code, name: r.name, description: r.description, permissions: r.permissions }));
  }

  team(ctx: RequestContext): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.appUser.findMany({
      where: { tenantId: ctx.tenantId, status: 'active' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async list(ctx: RequestContext): Promise<UserRow[]> {
    const users = await this.prisma.appUser.findMany({
      where: { tenantId: ctx.tenantId },
      include: { role: true, stores: { select: { storeId: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return users.map((u) => this.row(u));
  }

  async create(ctx: RequestContext, input: UserCreateInput): Promise<UserRow> {
    const role = await this.findRole(ctx, input.roleCode);
    this.assertCanGrant(ctx, role.permissions);
    await this.assertStores(ctx, input.storeIds);
    const passwordHash = await argon2.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appUser.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          email: input.email,
          whatsapp: input.whatsapp ?? null,
          passwordHash,
          roleId: role.id,
        },
      });
      if (input.storeIds.length) {
        await tx.userStore.createMany({
          data: input.storeIds.map((storeId) => ({ tenantId: ctx.tenantId, userId: created.id, storeId })),
        });
      }
      return tx.appUser.findUniqueOrThrow({
        where: { id: created.id },
        include: { role: true, stores: { select: { storeId: true } } },
      });
    });
    await this.audit.record(ctx, 'user.create', 'app_user', user.id, { email: user.email, role: role.code });
    return this.row(user);
  }

  async update(ctx: RequestContext, id: string, input: UserUpdateInput): Promise<UserRow> {
    const current = await this.prisma.appUser.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { role: true } });
    if (!current) throw new NotFoundError('usuário', id);
    const role = await this.findRole(ctx, input.roleCode);
    // Quem edita precisa ter tudo o que a pessoa tem hoje e tudo o que vai ter:
    // assim o gerente não mexe no proprietário nem se promove.
    this.assertCanGrant(ctx, current.role?.permissions ?? []);
    this.assertCanGrant(ctx, role.permissions);
    await this.assertStores(ctx, input.storeIds);

    const status = input.active ? 'active' : 'inactive';
    if (id === ctx.userId && (status !== 'active' || role.id !== current.roleId)) {
      throw new DomainError('SELF_LOCKOUT', 'Você não pode desativar nem trocar o próprio papel. Peça a outro proprietário.');
    }
    const losesOwner = current.role?.code === OWNER && (role.code !== OWNER || status !== 'active');
    if (losesOwner && (await this.activeOwners(ctx)) <= 1) {
      throw new DomainError('LAST_OWNER', 'A organização precisa de pelo menos um proprietário ativo.');
    }

    const passwordHash = input.password ? await argon2.hash(input.password) : undefined;
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id },
        data: {
          name: input.name,
          email: input.email,
          whatsapp: input.whatsapp ?? null,
          roleId: role.id,
          status,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      await tx.userStore.deleteMany({ where: { userId: id } });
      if (input.storeIds.length) {
        await tx.userStore.createMany({
          data: input.storeIds.map((storeId) => ({ tenantId: ctx.tenantId, userId: id, storeId })),
        });
      }
      return tx.appUser.findUniqueOrThrow({ where: { id }, include: { role: true, stores: { select: { storeId: true } } } });
    });
    this.access.forget(id, ctx.tenantId);
    await this.audit.record(ctx, 'user.update', 'app_user', id, {
      role: role.code,
      status,
      stores: input.storeIds,
      passwordChanged: Boolean(passwordHash),
    });
    return this.row(user);
  }

  private async findRole(ctx: RequestContext, code: string) {
    const role = await this.prisma.role.findFirst({
      where: { code, OR: [{ tenantId: ctx.tenantId }, { tenantId: null }] },
      orderBy: { tenantId: { sort: 'desc', nulls: 'last' } },
    });
    if (!role) throw new DomainError('ROLE_NOT_FOUND', 'Papel não encontrado', { code });
    return role;
  }

  /** Só se concede (ou se mexe em quem tem) o que você mesmo pode. */
  private assertCanGrant(ctx: RequestContext, permissions: string[]): void {
    if (ctx.permissions.includes('*')) return;
    const beyond = permissions.filter((p) => p === '*' || !ctx.permissions.includes(p));
    if (beyond.length) {
      throw new ForbiddenError('GRANT_DENIED', 'Você não pode dar nem alterar um acesso maior que o seu.', { beyond });
    }
  }

  private async assertStores(ctx: RequestContext, storeIds: string[]): Promise<void> {
    if (!storeIds.length) return;
    const found = await this.prisma.store.count({ where: { tenantId: ctx.tenantId, id: { in: storeIds } } });
    if (found !== new Set(storeIds).size) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada nesta organização');
  }

  private activeOwners(ctx: RequestContext): Promise<number> {
    return this.prisma.appUser.count({ where: { tenantId: ctx.tenantId, status: 'active', role: { code: OWNER } } });
  }

  private row(u: {
    id: string;
    name: string;
    email: string;
    whatsapp: string | null;
    status: string;
    lastLoginAt: Date | null;
    role: { code: string; name: string } | null;
    stores: Array<{ storeId: string }>;
  }): UserRow {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      whatsapp: u.whatsapp,
      active: u.status === 'active',
      roleCode: u.role?.code ?? null,
      roleName: u.role?.name ?? null,
      storeIds: u.stores.map((s) => s.storeId),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    };
  }
}
