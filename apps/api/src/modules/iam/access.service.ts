import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PermissionResolver } from '../../common/auth/permission-resolver';

interface Access {
  active: boolean;
  permissions: string[];
  storeIds: string[];
}

/**
 * Permissões e lojas de agora de cada usuário, com cache de um minuto: o guard
 * chama isto em toda requisição, e uma consulta por requisição seria desperdício.
 * Mudar papel ou lojas de alguém limpa o cache dele na hora (`forget`).
 */
@Injectable()
export class AccessService extends PermissionResolver {
  private readonly cache = new Map<string, { at: number; value: Access }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async resolve(userId: string, tenantId: string): Promise<Access> {
    const key = `${tenantId}:${userId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const value = await this.load(userId, tenantId);
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 5_000) this.cache.clear();
    return value;
  }

  /** Lido fora do isolamento de propósito: roda antes do contexto existir (login e guard). */
  async load(userId: string, tenantId: string): Promise<Access> {
    const user = await this.prisma.appUser.findFirst({
      where: { id: userId, tenantId },
      select: { status: true, role: { select: { permissions: true } }, stores: { select: { storeId: true } } },
    });
    if (!user) return { active: false, permissions: [], storeIds: [] };
    return {
      active: user.status === 'active',
      permissions: user.role?.permissions ?? [],
      storeIds: user.stores.map((s) => s.storeId),
    };
  }

  forget(userId: string, tenantId: string): void {
    this.cache.delete(`${tenantId}:${userId}`);
  }
}
