import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { jwtSecret } from '../../common/auth/token-payload';

/**
 * Cifra os tokens fiscais antes de gravar no banco (AES-256-GCM).
 * A chave sai do JWT_SECRET do servidor. Trocar esse segredo invalida os tokens
 * gravados: a tela passa a mostrar "não gravado" e é só colar de novo.
 */
function key(): Buffer {
  return createHash('sha256').update(`mercearia-fiscal:${jwtSecret()}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Devolve null se o valor não abre (segredo trocado ou dado corrompido). */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
