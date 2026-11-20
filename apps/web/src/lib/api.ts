import type { ApiErrorBody, SessionUser } from '@mercearia/contracts';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/v1';
const TOKEN_KEY = 'mercearia.token';
const USER_KEY = 'mercearia.user';

/** Avisada quando o servidor recusa a sessão, para a aplicação voltar ao login. */
let onExpired: (() => void) | null = null;
export function whenSessionExpires(callback: () => void): void {
  onExpired = callback;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const session = {
  token: (): string | null => read(TOKEN_KEY),
  user: (): SessionUser | null => {
    const raw = read(USER_KEY);
    try {
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  },
  save(token: string, user: SessionUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  updateUser(user: SessionUser): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

/**
 * Se vale a pena oferecer esta tela ou botão. Quem decide de verdade é o
 * servidor, que checa a permissão em cada rota — aqui é só para não oferecer
 * o que vai ser negado.
 */
export function can(permission: string | undefined, permissions = session.user()?.permissions ?? []): boolean {
  if (!permission) return true;
  return permissions.includes('*') || permissions.includes(permission);
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = session.token();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers, body });
  if (response.status === 401 && token) {
    session.clear();
    onExpired?.();
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const error = payload?.error;
    throw new ApiError(error?.code ?? 'ERROR', friendlyMessage(error), response.status, error?.details);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Erro de validação vem com a lista de campos: mostra o primeiro, que é o que a pessoa precisa corrigir. */
function friendlyMessage(error: ApiErrorBody['error'] | undefined): string {
  if (!error) return 'Não foi possível falar com o servidor. Tente de novo.';
  const issues = (error.details as { issues?: Array<{ message: string }> } | undefined)?.issues;
  if (error.code === 'BAD_REQUEST' && issues?.length) return issues[0]!.message;
  return error.message;
}

/** Recursos opcionais do servidor (ex.: WhatsApp conectado). Padrão: tudo desligado. */
export function fetchFeatures(): Promise<import('@mercearia/contracts').Features> {
  return api<import('@mercearia/contracts').Features>('/health/features').catch(() => ({ whatsapp: false, asaas: false }));
}
