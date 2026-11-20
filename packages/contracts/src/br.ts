/**
 * Documentos e contatos brasileiros. Usado na tela (validar enquanto digita),
 * na API (validar antes de gravar) e na importação do ssÓtica (normalizar).
 */

export const onlyDigits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '');

/** CPF válido pelos dígitos verificadores (rejeita 111.111.111-11 e afins). */
export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** CNPJ válido pelos dígitos verificadores. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(cnpj[i]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

export function formatCpf(value: string | null | undefined): string {
  const d = onlyDigits(value);
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : value ?? '';
}

export function formatCnpj(value: string | null | undefined): string {
  const d = onlyDigits(value);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : value ?? '';
}

/**
 * Telefone no formato do WhatsApp: 55 + DDD + número (12 ou 13 dígitos).
 * Aceita "(27) 99999-1234", "27999991234", "+55 27 9 9999-1234" e o 9º dígito
 * faltando em celular antigo. Devolve null se não der para entender.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  let d = onlyDigits(value);
  if (!d) return null;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return null;
  // Celular sem o 9 (DDD + 8 dígitos começando em 6-9): acrescenta.
  if (d.length === 12 && /^[6-9]/.test(d.slice(4))) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value);
  const local = d.startsWith('55') ? d.slice(2) : d;
  if (local.length === 11) return local.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (local.length === 10) return local.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return value ?? '';
}

export function formatCep(value: string | null | undefined): string {
  const d = onlyDigits(value);
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : value ?? '';
}

/**
 * Texto de busca do cliente: nome sem acento em minúsculas + CPF + telefones,
 * tudo junto. Fica numa coluna com índice de trigramas, então "joao 2799"
 * acha "João da Silva (27) 99..." rápido mesmo com dezenas de milhares.
 */
export function searchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .map((p) => normalizeText(p as string))
    .join(' ')
    .trim();
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome próprio em caixa normal: "MARIA DA SILVA" → "Maria da Silva". */
export function properName(value: string): string {
  const lower = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && lower.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

/**
 * "Hoje" no horário de Brasília (AAAA-MM-DD). O servidor roda em UTC: sem isto,
 * depois das 21h o sistema já acha que é amanhã (receita vence um dia antes,
 * data padrão do exame sai errada).
 */
export function todayBR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
