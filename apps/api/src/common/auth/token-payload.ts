/** Claims do JWT. A organização vem daqui — nunca do corpo da requisição. */
export interface TokenPayload {
  sub: string;
  tenantId: string;
  storeIds: string[];
  permissions: string[];
}

/**
 * `expiresIn` do jsonwebtoken aceita "12h" em tempo de execução, mas o tipo
 * publicado só admite um literal conhecido. Centralizamos a conversão aqui.
 */
export function expiresIn(value: string | undefined, fallback: string): number {
  return (value ?? fallback) as unknown as number;
}

/** Sem segredo de produção a API não sobe: token assinado com chave conhecida é porta aberta. */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET ausente ou curto (mínimo 32 caracteres). Gere com: openssl rand -hex 32');
  }
  return 'desenvolvimento-inseguro-nao-use-em-producao';
}
