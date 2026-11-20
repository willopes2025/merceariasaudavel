import { AsyncLocalStorage } from 'node:async_hooks';
import { currentContext, type RequestContext } from '../tenancy/request-context';

/**
 * Isolamento por organização no próprio banco (segunda camada de defesa).
 * Copiado do Soul ERP.
 *
 * A aplicação já filtra por organização em toda consulta; aqui o PostgreSQL
 * passa a garantir isso também. Em toda operação feita dentro de uma
 * requisição autenticada, a conexão troca para a role `mercearia_app` (que obedece
 * às políticas de RLS) e diz quais organizações aquela requisição pode
 * enxergar (`app.tenant_ids`). Um bug de consulta que esquecesse o filtro
 * devolve vazio em vez de dado de outra empresa.
 *
 * Fora de requisição (rotinas agendadas, webhooks públicos, login, migração)
 * a conexão segue com a role dona das tabelas: são caminhos do próprio
 * sistema, que precisam ver todas as empresas.
 *
 * Ligado por `DB_ISOLATION=on` (padrão do docker-compose de produção). Sem a variável, nada muda — é o interruptor
 * para voltar atrás sem novo deploy se algo inesperado aparecer.
 */
export const isolationEnabled = () => (process.env.DB_ISOLATION ?? 'off').toLowerCase() === 'on';

/** Dentro de uma transação interativa já configurada: as operações só seguem. */
const inConfiguredTx = new AsyncLocalStorage<boolean>();

/** Organizações visíveis para a requisição. */
export type VisibleTenants = (ctx: RequestContext) => Promise<string[]>;

const SET_SQL = `SELECT set_config('role', 'mercearia_app', true), set_config('app.tenant_ids', $1, true), set_config('app.tenant_id', $2, true)`;

interface RawCapable {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<unknown>;
}
type Client = RawCapable & {
  $extends: (ext: unknown) => unknown;
  $transaction: (...args: any[]) => Promise<any>;
};

/** Os comandos que preparam a conexão (só os valores; quem executa decide como). */
export function isolationParams(tenants: readonly string[], primary: string): [string, string] {
  // Vírgula separa a lista: um id com vírgula seria tentativa de injeção.
  const safe = tenants.filter((t) => /^[\w-]+$/.test(t));
  return [safe.join(','), /^[\w-]+$/.test(primary) ? primary : ''];
}

/**
 * Embrulha o cliente do Prisma. Devolve o cliente estendido, com `$transaction`
 * (forma interativa) preparando a conexão antes do código da transação.
 */
export function withTenantIsolation<T extends Client>(base: T, visible: VisibleTenants): T {

  const extended = base.$extends({
    query: {
      async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
        const ctx = currentContext();
        if (!ctx || !isolationEnabled() || inConfiguredTx.getStore()) return query(args);
        const [list, primary] = isolationParams(await visible(ctx), ctx.tenantId);
        // Transação em lote: prepara a conexão e roda a operação nela.
        const results = await base.$transaction([base.$executeRawUnsafe(SET_SQL, list, primary), query(args)]);
        return results[1];
      },
    },
  }) as T;

  const original = extended.$transaction.bind(extended);
  const wrapped = async (arg: unknown, options?: unknown) => {
    const ctx = currentContext();
    if (typeof arg !== 'function' || !ctx || !isolationEnabled() || inConfiguredTx.getStore()) return original(arg, options);
    // A lista de empresas sai antes de abrir a transação: dentro dela, a
    // conexão já está presa e uma consulta paralela esperaria por ela.
    const [list, primary] = isolationParams(await visible(ctx), ctx.tenantId);
    return original(
      (tx: RawCapable) =>
        // Tudo dentro (inclusive o preparo) roda marcado: o gancho não abre outra transação.
        inConfiguredTx.run(true, async () => {
          await tx.$executeRawUnsafe(SET_SQL, list, primary);
          return (arg as (t: unknown) => Promise<unknown>)(tx);
        }),
      options,
    );
  };
  try {
    Object.defineProperty(extended, '$transaction', { value: wrapped, configurable: true, writable: true });
  } catch {
    (extended as { $transaction: unknown }).$transaction = wrapped;
  }
  return extended;
}
