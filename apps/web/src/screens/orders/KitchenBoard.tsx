import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_CHANNELS, ORDER_NEXT, type Order, type OrderStatus, type Store } from '@mercearia/contracts';
import { api, session } from '../../lib/api';
import { ErrorBox, Loading } from '../../components/ui';
import { formatQty } from '../../components/format';

const COLUMNS: Array<{ status: OrderStatus; title: string; action: string; tone: string }> = [
  { status: 'na_fila', title: 'Na fila', action: 'Começar', tone: 'border-amber-300 bg-amber-50' },
  { status: 'preparando', title: 'Preparando', action: 'Pronto', tone: 'border-sky-300 bg-sky-50' },
  { status: 'pronto', title: 'Pronto — chamar no balcão', action: 'Entregue', tone: 'border-brand bg-brand-soft' },
];

const minutesSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000)) : 0);

/** Bip curto quando chega pedido novo (o navegador só deixa tocar depois de um clique na tela). */
function useBeep() {
  const ctx = useRef<AudioContext | null>(null);
  return {
    enable() {
      try {
        ctx.current ??= new AudioContext();
        void ctx.current.resume();
      } catch {
        /* sem áudio */
      }
    },
    play() {
      const c = ctx.current;
      if (!c || c.state !== 'running') return;
      for (const [i, f] of [880, 1320].entries()) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.18 + 0.16);
        o.connect(g).connect(c.destination);
        o.start(c.currentTime + i * 0.18);
        o.stop(c.currentTime + i * 0.18 + 0.17);
      }
    },
  };
}

/**
 * Tela de preparo (tablet/TV na bancada). Pedido pago entra na fila; toque
 * para começar, marcar pronto e entregue. Atualiza sozinha a cada 4 segundos
 * e bipa quando chega pedido novo.
 */
export function KitchenBoard() {
  const client = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const mine = (stores.data ?? []).filter((s) => s.active && (!session.user()?.storeIds.length || session.user()!.storeIds.includes(s.id)));
  const [storeId, setStoreId] = useState(() => localStorage.getItem('mercearia.pdv.store') ?? '');
  useEffect(() => {
    if (mine.length && !mine.some((s) => s.id === storeId)) setStoreId(mine[0]!.id);
  }, [mine, storeId]);

  const board = useQuery({ queryKey: ['orders-board', storeId], queryFn: () => api<Order[]>(`/orders/board?storeId=${storeId}`), enabled: Boolean(storeId), refetchInterval: 4_000 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(t);
  }, []);

  const beep = useBeep();
  const [sound, setSound] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!board.data) return;
    const queued = board.data.filter((o) => o.status === 'na_fila').map((o) => o.id);
    if (seen.current && sound && queued.some((id) => !seen.current!.has(id))) beep.play();
    seen.current = new Set(board.data.map((o) => o.id));
  }, [board.data, sound, beep]);

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api<Order>(`/orders/${id}/advance`, { method: 'POST', json: { status } }),
    onSettled: () => client.invalidateQueries({ queryKey: ['orders-board'] }),
  });

  if (stores.isLoading) return <Loading />;
  const orders = board.data ?? [];
  const delivered = orders.filter((o) => o.status === 'entregue').sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Tela de preparo</h1>
          {mine.length > 1 && (
            <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
              {mine.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {board.isFetching && <span className="h-2 w-2 animate-pulse rounded-full bg-brand" title="Atualizando" />}
        </div>
        <div className="flex gap-2">
          <button
            className={`btn-ghost ${sound ? 'border-brand text-brand' : ''}`}
            onClick={() => {
              beep.enable();
              setSound((v) => !v);
            }}
          >
            {sound ? '🔔 Som ligado' : '🔕 Ligar som'}
          </button>
          <button className="btn-ghost" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>
            Tela cheia
          </button>
        </div>
      </div>
      <ErrorBox error={board.error ?? advance.error} />
      <div className="grid gap-3 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => o.status === col.status);
          return (
            <section key={col.status} className="min-h-[50vh] rounded-2xl bg-slate-100 p-3">
              <h2 className="mb-3 flex items-center justify-between font-semibold">
                {col.title}
                <span className="rounded-full bg-white px-2 text-sm">{list.length}</span>
              </h2>
              <div className="space-y-3">
                {list.map((o) => {
                  const waited = minutesSince(o.paidAt ?? o.createdAt, now);
                  const late = col.status !== 'pronto' && waited >= 15 ? 'text-red-600' : col.status !== 'pronto' && waited >= 8 ? 'text-amber-700' : 'text-ink-soft';
                  return (
                    <article key={o.id} className={`rounded-xl border-2 bg-white p-3 shadow-sm ${col.tone}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-3xl font-bold leading-none tabular-nums">{o.number}</p>
                          <p className="mt-1 font-semibold">{o.callName}</p>
                        </div>
                        <div className="text-right text-xs">
                          <span className="badge bg-white">{ORDER_CHANNELS[o.channel]}</span>
                          <p className={`mt-1 font-medium ${late}`}>{waited === 0 ? 'agora' : `há ${waited} min`}</p>
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1 text-base">
                        {o.items.map((i, n) => (
                          <li key={n}>
                            <b>{i.unit === 'UN' ? i.quantity : formatQty(i.quantity, i.unit)}×</b> {i.description}
                            {i.options.length > 0 && <div className="pl-5 text-sm font-semibold text-brand-dark">{i.options.map((x) => x.name).join(' · ')}</div>}
                          </li>
                        ))}
                      </ul>
                      {o.notes && <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-sm font-medium text-amber-900">Obs.: {o.notes}</p>}
                      <button
                        className="btn-primary mt-3 w-full py-3 text-base"
                        disabled={advance.isPending}
                        onClick={() => advance.mutate({ id: o.id, status: ORDER_NEXT[o.status]! })}
                      >
                        {col.action}
                      </button>
                      {col.status === 'na_fila' && (
                        <button className="mt-1 w-full text-xs text-ink-soft underline" onClick={() => advance.mutate({ id: o.id, status: 'pronto' })}>
                          Já está pronto
                        </button>
                      )}
                    </article>
                  );
                })}
                {!list.length && <p className="py-8 text-center text-sm text-ink-soft">Nada aqui.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {delivered.length > 0 && (
        <p className="text-xs text-ink-soft">
          Entregues nos últimos 20 min: {delivered.map((o) => `${o.number} (${o.callName})`).join(' · ')}
        </p>
      )}
    </div>
  );
}
