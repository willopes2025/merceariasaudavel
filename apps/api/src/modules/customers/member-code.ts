import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { MEMBER_CODE_ALPHABET, weakPin } from '@mercearia/contracts';

type Db = Pick<Prisma.TransactionClient, 'customer'>;

export function newMemberCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += MEMBER_CODE_ALPHABET[randomInt(MEMBER_CODE_ALPHABET.length)];
  return code;
}

/**
 * Dá um código de cartão ao membro que ainda não tem. O código é único na
 * organização; numa colisão (raríssima com 31^6 combinações) tenta outro.
 */
export async function ensureMemberCode(db: Db, tenantId: string, customerId: string): Promise<string> {
  const current = await db.customer.findFirst({ where: { id: customerId, tenantId }, select: { memberCode: true } });
  if (current?.memberCode) return current.memberCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newMemberCode();
    const taken = await db.customer.count({ where: { tenantId, memberCode: code } });
    if (taken) continue;
    try {
      await db.customer.update({ where: { id: customerId }, data: { memberCode: code } });
      return code;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
  throw new Error('Não foi possível gerar o código do cartão de membro');
}

/** Código provisório de 6 números para o cliente entrar no app pela primeira vez. */
export function temporaryPin(): string {
  for (;;) {
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!weakPin(pin)) return pin;
  }
}
