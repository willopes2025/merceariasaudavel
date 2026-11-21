import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addressLine, formatMoney, formatPhone, whatsappLink, type CourierRun } from '@mercearia/contracts';
import { ApiError } from '../lib/api';
import { Leaf, Spinner } from './parts';

const client = new QueryClient({ defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3 } } });
const BASE_URL = import.meta.env.VITE_API_URL ?? '/v1';

async function courierApi<T>(path: string, method = 'GET'): Promise<T> {
  const res = await fetch(`${BASE_URL}/courier/${path}`, { method });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Não foi possível falar com a loja.', res.status);
  }
  return (await res.json()) as T;
}

/** Página do entregador (/entregador/<token>): entregas em rota, mapa, ligar e marcar entregue. */
export function CourierPage({ token }: { token: string }) {
  return (
    <QueryClientProvider client={client}>
      <Run token={token} />
    </QueryClientProvider>
  );
}

function Run({ token }: { token: string }) {
  const qc = useQueryClient();
  const run = useQuery({ queryKey: ['run'], queryFn: () => courierApi<CourierRun>(token), refetchInterval: 20_000 });
  const done = useMutation({ mutationFn: (id: string) => courierApi<CourierRun>(`${token}/orders/${id}/delivered`, 'POST'), onSuccess: (r) => qc.setQueryData(['run'], r) });
  useEffect(() => {
    document.title = 'Entregas';
  }, []);
  if (run.isLoading) return <Spinner />;
  if (run.error)
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <Leaf className="mx-auto h-10 w-10" />
        <p className="mt-4 font-semibold">Link inválido ou desativado.</p>
        <p className="text-sm text-ink-soft">Peça um link novo para a loja.</p>
      </div>
    );
  const r = run.data!;
  const onRoute = r.orders.filter((o) => o.status === 'saiu_entrega');
  const delivered = r.orders.filter((o) => o.status === 'entregue');
  return (
    <div className="mx-auto min-h-screen max-w-md bg-[#F6F8F4] px-4 pb-10">
      <header className="flex items-center gap-2 py-4">
        <Leaf className="h-7 w-7" />
        <div>
          <p className="font-bold text-brand-dark">{r.storeName}</p>
          <p className="text-xs text-ink-soft">Entregas de {r.courierName}</p>
        </div>
      </header>
      {done.error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{(done.error as Error).message}</p>}
      {!onRoute.length && <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-soft shadow-sm">Nenhuma entrega com você agora. Esta página atualiza sozinha.</p>}
      <div className="space-y-3">
        {onRoute.map((o) => (
          <article key={o.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <p className="text-3xl font-bold tabular-nums">{o.number}</p>
              {o.toCollect > 0 ? (
                <div className="text-right">
                  <p className="text-xs text-ink-soft">Cobrar</p>
                  <p className="text-xl font-bold text-brand">{formatMoney(o.toCollect)}</p>
                </div>
              ) : (
                <span className="badge bg-brand-soft text-brand">Já pago</span>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold">{o.customerName}</p>
            <p className="text-sm">{addressLine(o.address)}</p>
            {o.address.reference && <p className="text-sm text-ink-soft">Ref.: {o.address.reference}</p>}
            {o.paymentNote && <p className="mt-1 text-sm font-medium text-amber-800">{o.paymentNote}</p>}
            <ul className="mt-2 text-sm text-ink-soft">
              {o.items.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
            {o.notes && <p className="mt-1 text-sm">Obs.: {o.notes}</p>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <a href={o.mapsUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-brand-soft py-3 text-center text-sm font-semibold text-brand-dark">
                Rota
              </a>
              {o.phone ? (
                <a href={`tel:+${o.phone}`} className="rounded-xl bg-brand-soft py-3 text-center text-sm font-semibold text-brand-dark">
                  Ligar
                </a>
              ) : (
                <span />
              )}
              {o.phone ? (
                <a href={whatsappLink(o.phone, `Oi, ${o.customerName.split(' ')[0]}! Aqui é o entregador da ${r.storeName}, estou a caminho com o seu pedido nº ${o.number}.`)} target="_blank" rel="noreferrer" className="rounded-xl bg-brand-soft py-3 text-center text-sm font-semibold text-brand-dark">
                  WhatsApp
                </a>
              ) : (
                <span />
              )}
            </div>
            <button className="mt-2 w-full rounded-xl bg-brand py-3.5 text-base font-bold text-white disabled:opacity-60" disabled={done.isPending} onClick={() => done.mutate(o.id)}>
              Entregue
            </button>
          </article>
        ))}
      </div>
      {delivered.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink-soft">Entregues hoje</h2>
          <ul className="space-y-1 text-sm">
            {delivered.map((o) => (
              <li key={o.id} className="flex justify-between rounded-lg bg-white px-3 py-2">
                <span>
                  Nº {o.number} · {o.customerName}
                </span>
                <span className="text-ink-soft">{o.deliveredAt ? new Date(o.deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.orders[0]?.phone && <p className="sr-only">{formatPhone(r.orders[0].phone)}</p>}
    </div>
  );
}
