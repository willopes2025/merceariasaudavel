import type { ApiErrorBody } from '@mercearia/contracts';
import { ApiError } from '../lib/api';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/v1';
/** Endereço público da loja (um só, por enquanto). */
export const SHOP_SLUG = (import.meta.env.VITE_SHOP_SLUG as string | undefined) ?? 'mercearia-saudavel';
const TOKEN_KEY = 'mercearia.cliente';

let onExpired: (() => void) | null = null;
export function whenCustomerSessionExpires(callback: () => void): void {
  onExpired = callback;
}

/** Sessão do cliente: separada da sessão da equipe (outra chave, outro token). */
export const customerSession = {
  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  save(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* navegador sem armazenamento: fica logado só nesta aba */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nada a limpar */
    }
  },
};

export async function shopApi<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = customerSession.token();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/shop/${SHOP_SLUG}${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError('OFFLINE', 'Sem internet agora. Confira a conexão e tente de novo.', 0);
  }
  if (response.status === 401 && token && path.startsWith('/me')) {
    customerSession.clear();
    onExpired?.();
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const error = payload?.error;
    const issues = (error?.details as { issues?: Array<{ message: string }> } | undefined)?.issues;
    const message = error ? (error.code === 'BAD_REQUEST' && issues?.length ? issues[0]!.message : error.message) : 'Não foi possível falar com a loja. Tente de novo.';
    throw new ApiError(error?.code ?? 'ERROR', message, response.status, error?.details);
  }
  return (await response.json()) as T;
}
