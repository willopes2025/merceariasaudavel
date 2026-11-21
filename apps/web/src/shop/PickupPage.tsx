import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { PickupBoard, ShopInfo } from '@mercearia/contracts';
import { shopApi } from './api';
import { Leaf } from './parts';

const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });

/**
 * Painel de retirada (/retirada): TV perto do balcão. Mostra os números
 * preparando e prontos, só com o primeiro nome. Atualiza a cada 4 s e toca
 * um aviso quando um pedido fica pronto.
 */
export function PickupPage() {
  return (
    <QueryClientProvider client={client}>
      <Pickup />
    </QueryClientProvider>
  );
}

function Pickup() {
  const info = useQuery({ queryKey: ['info'], queryFn: () => shopApi<ShopInfo>(''), staleTime: 10 * 60_000 });
  const board = useQuery({ queryKey: ['pickup'], queryFn: () => shopApi<PickupBoard>('/pickup'), refetchInterval: 4_000 });
  const ready = useRef<Set<number> | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    document.title = 'Retirada — Mercearia Saudável';
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch {
        /* sem áudio */
      }
    };
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (!board.data) return;
    const now = new Set(board.data.ready.map((r) => r.number));
    const fresh = ready.current && [...now].some((n) => !ready.current!.has(n));
    ready.current = now;
    const c = audio.current;
    if (fresh && c && c.state === 'running') {
      for (const [i, f] of [660, 990, 1320].entries()) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.2);
        g.gain.exponentialRampToValueAtTime(0.3, c.currentTime + i * 0.2 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.2 + 0.18);
        o.connect(g).connect(c.destination);
        o.start(c.currentTime + i * 0.2);
        o.stop(c.currentTime + i * 0.2 + 0.2);
      }
    }
  }, [board.data]);

  const data = board.data ?? { preparing: [], ready: [] };
  return (
    <div className="flex min-h-screen flex-col bg-ink p-6 text-white">
      <header className="mb-6 flex items-center gap-4">
        <Leaf className="h-12 w-12" />
        <p className="font-display text-3xl font-semibold">{info.data?.storeName ?? 'Mercearia Saudável'}</p>
        <p className="ml-auto text-xl text-white/60">Retirada de pedidos</p>
      </header>
      <div className="grid flex-1 grid-cols-2 gap-6">
        <section className="rounded-3xl bg-white/5 p-6">
          <h2 className="mb-6 text-3xl font-bold text-white/70">Preparando</h2>
          <div className="flex flex-wrap gap-4">
            {data.preparing.map((p) => (
              <div key={p.number} className="min-w-[160px] rounded-2xl bg-white/10 px-5 py-4 text-center">
                <p className="text-6xl font-bold tabular-nums text-white/80">{p.number}</p>
                <p className="mt-1 text-xl text-white/60">{p.callName}</p>
              </div>
            ))}
            {!data.preparing.length && <p className="text-xl text-white/40">—</p>}
          </div>
        </section>
        <section className="rounded-3xl bg-brand p-6">
          <h2 className="mb-6 text-3xl font-bold text-sun">Pronto! Retire no balcão</h2>
          <div className="flex flex-wrap gap-4">
            {data.ready.map((p) => (
              <div key={p.number} className="min-w-[180px] animate-[pulse_2s_ease-in-out_3] rounded-2xl bg-white px-6 py-5 text-center text-ink">
                <p className="text-7xl font-bold tabular-nums">{p.number}</p>
                <p className="mt-1 text-2xl font-semibold">{p.callName}</p>
              </div>
            ))}
            {!data.ready.length && <p className="text-xl text-white/60">Assim que ficar pronto, o seu número aparece aqui.</p>}
          </div>
        </section>
      </div>
      {board.error && <p className="mt-4 text-center text-white/50">Sem conexão. Tentando de novo…</p>}
    </div>
  );
}
