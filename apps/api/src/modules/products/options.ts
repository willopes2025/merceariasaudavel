import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { OptionGroupView, OptionGroupsInput, Unit } from '@mercearia/contracts';
import { DomainError } from '../../common/errors/domain-error';

type Db = Pick<Prisma.TransactionClient, 'optionGroup' | 'productOption' | 'product'>;

/** Montagem ativa de vários produtos de uma vez (caixa, app, totem). */
export async function loadOptionGroups(db: Db, tenantId: string, productIds: string[]): Promise<Map<string, OptionGroupView[]>> {
  const map = new Map<string, OptionGroupView[]>();
  if (!productIds.length) return map;
  const groups = await db.optionGroup.findMany({
    where: { tenantId, productId: { in: productIds }, active: true },
    include: { options: { where: { active: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }], include: { supply: { select: { name: true, unit: true } } } } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  for (const g of groups) {
    if (!g.options.length) continue;
    const list = map.get(g.productId) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        price: Number(o.price),
        supplyId: o.supplyId,
        supplyName: o.supply?.name ?? null,
        supplyUnit: (o.supply?.unit as Unit | undefined) ?? null,
        supplyQty: o.supplyQty == null ? null : Number(o.supplyQty),
      })),
    });
    map.set(g.productId, list);
  }
  return map;
}

/**
 * Grava a montagem inteira do produto (substitui a anterior). Ids que já são
 * deste produto continuam os mesmos — pedido aberto no app que usa a opção não
 * quebra; opção removida some (a venda já feita guarda o nome e o preço).
 */
export async function saveOptionGroups(tx: Prisma.TransactionClient, tenantId: string, productId: string, input: OptionGroupsInput): Promise<void> {
  const supplyIds = [...new Set(input.groups.flatMap((g) => g.options.map((o) => o.supplyId)).filter((v): v is string => Boolean(v)))];
  if (supplyIds.length) {
    const supplies = await tx.product.findMany({ where: { tenantId, id: { in: supplyIds } }, select: { id: true, kind: true, name: true } });
    if (supplies.length !== supplyIds.length) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos insumos da montagem não foi encontrado.');
    const bad = supplies.find((s) => s.kind === 'preparado' || s.id === productId);
    if (bad) throw new DomainError('OPTION_SUPPLY_INVALID', `"${bad.name}" não pode ser insumo de uma opção: use um insumo ou produto de revenda.`);
  }
  const current = await tx.optionGroup.findMany({ where: { tenantId, productId }, include: { options: { select: { id: true } } } });
  const ownGroups = new Set(current.map((g) => g.id));
  const ownOptions = new Set(current.flatMap((g) => g.options.map((o) => o.id)));
  await tx.optionGroup.deleteMany({ where: { tenantId, productId } });
  for (const [gi, g] of input.groups.entries()) {
    const groupId = g.id && ownGroups.has(g.id) ? g.id : randomUUID();
    await tx.optionGroup.create({ data: { id: groupId, tenantId, productId, name: g.name, minSelect: g.minSelect, maxSelect: Math.min(g.maxSelect, g.options.length), position: gi } });
    await tx.productOption.createMany({
      data: g.options.map((o, oi) => ({
        id: o.id && ownOptions.has(o.id) ? o.id : randomUUID(),
        tenantId,
        groupId,
        name: o.name,
        price: o.price,
        supplyId: o.supplyId,
        supplyQty: o.supplyQty,
        position: oi,
      })),
    });
  }
}
