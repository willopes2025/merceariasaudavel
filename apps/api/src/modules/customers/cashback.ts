import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
const cents = (v: number | Prisma.Decimal | null | undefined) => Math.round(Number(v ?? 0) * 100);

/**
 * Único jeito de mexer no saldo de cashback: trava a cliente, soma e grava o
 * extrato com o saldo resultante. O banco não deixa o saldo ficar negativo.
 */
export async function moveCashback(
  tx: Tx,
  p: { tenantId: string; customerId: string; type: 'credito' | 'uso' | 'estorno' | 'vencido' | 'ajuste'; amount: number; saleId?: string | null; expiresAt?: Date | null; note?: string | null; userId?: string | null },
): Promise<number> {
  if (cents(p.amount) === 0) return 0;
  const rows = await tx.$queryRaw<Array<{ cashback_balance: Prisma.Decimal }>>`
    SELECT cashback_balance FROM customer WHERE id = ${p.customerId} AND tenant_id = ${p.tenantId} FOR UPDATE`;
  if (!rows[0]) throw new Error('Cliente não encontrada para o cashback');
  const after = cents(rows[0].cashback_balance) + cents(p.amount);
  if (after < 0) throw new Error('Saldo de cashback insuficiente');
  await tx.customer.update({ where: { id: p.customerId }, data: { cashbackBalance: after / 100 } });
  await tx.cashbackEntry.create({
    data: { tenantId: p.tenantId, customerId: p.customerId, type: p.type, amount: cents(p.amount) / 100, balanceAfter: after / 100, saleId: p.saleId ?? null, expiresAt: p.expiresAt ?? null, note: p.note ?? null, userId: p.userId ?? null },
  });
  return after / 100;
}

export interface ClubRules {
  cashbackPct: number;
  cashbackDays: number;
  cashbackMaxUsePct: number;
}

export async function clubRules(db: { tenantSetting: Prisma.TransactionClient['tenantSetting'] }, tenantId: string): Promise<ClubRules> {
  const row = await db.tenantSetting.findUnique({ where: { tenantId } });
  return { cashbackPct: Number(row?.cashbackPct ?? 0), cashbackDays: row?.cashbackDays ?? 0, cashbackMaxUsePct: Number(row?.cashbackMaxUsePct ?? 100) };
}
