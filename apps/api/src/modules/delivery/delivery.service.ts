import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Courier, CourierInput, DeliverySettingsInput, DeliveryZone, DeliveryZoneInput } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

const newToken = () => randomBytes(16).toString('hex');

/** Configuração da entrega: liga/desliga, bairros e entregadores. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async settings(ctx: RequestContext): Promise<{ deliveryEnabled: boolean; deliveryCity: string | null }> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { deliveryEnabled: true, deliveryCity: true } });
    return { deliveryEnabled: s?.deliveryEnabled ?? false, deliveryCity: s?.deliveryCity ?? null };
  }

  async saveSettings(ctx: RequestContext, input: DeliverySettingsInput) {
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...input }, update: input });
    await this.audit.record(ctx, 'delivery.settings', 'tenant', ctx.tenantId, input);
    return this.settings(ctx);
  }

  async zones(ctx: RequestContext): Promise<DeliveryZone[]> {
    const rows = await this.prisma.deliveryZone.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map((z) => ({ id: z.id, name: z.name, fee: Number(z.fee), minOrder: Number(z.minOrder), freeAbove: z.freeAbove == null ? null : Number(z.freeAbove), etaMinutes: z.etaMinutes, active: z.active }));
  }

  async saveZone(ctx: RequestContext, id: string | null, input: DeliveryZoneInput): Promise<DeliveryZone[]> {
    if (id && !(await this.prisma.deliveryZone.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('bairro', id);
    try {
      if (id) await this.prisma.deliveryZone.update({ where: { id }, data: input });
      else await this.prisma.deliveryZone.create({ data: { ...input, tenantId: ctx.tenantId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('ZONE_TAKEN', `O bairro ${input.name} já está cadastrado.`);
      throw e;
    }
    await this.audit.record(ctx, id ? 'delivery.zone_update' : 'delivery.zone_create', 'delivery_zone', id ?? input.name, input);
    return this.zones(ctx);
  }

  async couriers(ctx: RequestContext): Promise<Courier[]> {
    const rows = await this.prisma.courier.findMany({ where: { tenantId: ctx.tenantId }, include: { _count: { select: { orders: { where: { status: 'saiu_entrega' } } } } }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone, active: c.active, path: `/entregador/${c.token}`, onRoute: c._count.orders }));
  }

  async saveCourier(ctx: RequestContext, id: string | null, input: CourierInput): Promise<Courier[]> {
    if (id) {
      const changed = await this.prisma.courier.updateMany({ where: { id, tenantId: ctx.tenantId }, data: input });
      if (!changed.count) throw new NotFoundError('entregador', id);
    } else {
      await this.prisma.courier.create({ data: { ...input, tenantId: ctx.tenantId, token: newToken() } });
    }
    await this.audit.record(ctx, id ? 'courier.update' : 'courier.create', 'courier', id ?? input.name, { name: input.name });
    return this.couriers(ctx);
  }

  /** Link novo: o antigo para de funcionar (perdeu o celular, saiu da equipe). */
  async rotateCourier(ctx: RequestContext, id: string): Promise<Courier[]> {
    const changed = await this.prisma.courier.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { token: newToken() } });
    if (!changed.count) throw new NotFoundError('entregador', id);
    await this.audit.record(ctx, 'courier.rotate', 'courier', id, {});
    return this.couriers(ctx);
  }
}
