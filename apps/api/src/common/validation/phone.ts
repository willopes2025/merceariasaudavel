import { z } from 'zod';

/**
 * Telefone no formato único do sistema: +DDI DDD número, tudo junto
 * (ex.: +5527999990000). Aceita o que a pessoa digita — "(27) 99999-0000",
 * "027 3333-4444", "55 27 99999 0000", "+1 305 555 0100" — e converte.
 * Sem DDI, vale o Brasil (+55). Devolve null para vazio e undefined para inválido.
 */
export function normalizePhone(raw: string | null | undefined): string | null | undefined {
  const text = (raw ?? '').trim();
  if (!text) return null;
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+') || text.startsWith('00')) {
    digits = digits.replace(/^00/, '');
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : undefined;
  }
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return undefined;
}

export const PHONE_HINT = 'Telefone inválido: use +DDI DDD número, ex.: +5527999990000';

/** Campo de telefone opcional: converte para +DDI DDD número ou recusa. */
export const phoneField = () =>
  z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const n = normalizePhone(v);
      if (n === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_HINT });
        return z.NEVER;
      }
      return n;
    });
