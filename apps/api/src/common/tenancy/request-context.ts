import { AsyncLocalStorage } from 'node:async_hooks';

/** Quem está falando com a API nesta requisição. Nunca vem do corpo do request. */
export interface RequestContext {
  tenantId: string;
  userId: string;
  /** Lojas em que a pessoa trabalha; vazio = todas as lojas da organização. */
  storeIds: string[];
  permissions: string[];
}

/**
 * O escopo é aberto por middleware (antes dos guards) e preenchido pelo guard
 * depois de validar o token. Guardamos um invólucro mutável porque o
 * AsyncLocalStorage fecha o escopo quando a função que o abriu retorna — e o
 * guard retorna antes do handler rodar. (Mesmo desenho do Soul ERP.)
 */
interface ContextHolder {
  current?: RequestContext;
}

const storage = new AsyncLocalStorage<ContextHolder>();

export function runWithContextScope<T>(callback: () => T): T {
  return storage.run({}, callback);
}

export function setContext(context: RequestContext): void {
  const holder = storage.getStore();
  if (!holder) throw new Error('Escopo de requisição não aberto — falta o RequestContextMiddleware');
  holder.current = context;
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore()?.current;
}

export function requireContext(): RequestContext {
  const context = currentContext();
  if (!context) throw new Error('Contexto de requisição ausente — rota fora do AuthGuard');
  return context;
}

/** A pessoa pode trabalhar nesta loja? (sem lojas na ficha = todas) */
export function canUseStore(ctx: RequestContext, storeId: string): boolean {
  return ctx.storeIds.length === 0 || ctx.storeIds.includes(storeId);
}
