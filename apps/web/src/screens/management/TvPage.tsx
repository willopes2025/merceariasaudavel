import { useEffect, useState } from 'react';
import type { TvData } from '@mercearia/contracts';
import { formatMoney } from '../../components/format';

const BASE = import.meta.env.VITE_API_URL ?? '/v1';
const COLOR = { green: '#4ade80', yellow: '#facc15', red: '#f87171' } as const;

/**
 * Tela da TV: abre sem login pelo link fixo, em tela cheia, e busca os números
 * de novo a cada minuto. Se a internet cair, continua mostrando o último dado.
 */
export function TvPage({ token }: { token: string }) {
  const [data, setData] = useState<TvData | null>(null);
  const [error, setError] = useState('');
  const [slide, setSlide] = useState(0);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/tv/${encodeURIComponent(token)}`);
        if (r.status === 404) {
          setError('Este link de TV não existe mais. Peça um novo em Configurações › Telas de TV.');
          return;
        }
        if (r.ok) {
          const d = (await r.json()) as TvData;
          setData(d);
          setError('');
          timer = setTimeout(load, d.refreshSeconds * 1000);
          return;
        }
      } catch {
        /* sem internet: mantém o último dado */
      }
      timer = setTimeout(load, 30_000);
    };
    load();
    return () => clearTimeout(timer);
  }, [token]);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    const s = setInterval(() => setSlide((n) => n + 1), 15_000);
    return () => {
      clearInterval(t);
      clearInterval(s);
    };
  }, []);

  if (error) return <Screen><p className="text-3xl">{error}</p></Screen>;
  if (!data) return <Screen><p className="text-3xl opacity-60">Carregando…</p></Screen>;

  const slides = data.mode === 'cliente' ? ['offers', 'club'] : ['today', 'goals', 'ranking', 'offers'].filter((s) => s !== 'goals' || data.goals.length);
  const current = slides[slide % slides.length];
  const dayPct = data.dayTarget ? Math.min(1, data.today.total / data.dayTarget) : null;
  const maxHour = Math.max(1, ...data.byHour.map((h) => h.total));

  return (
    <Screen>
      <header className="mb-10 flex items-center justify-between text-2xl">
        <span className="flex items-center gap-3 font-bold">
          <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="#B8E06A" strokeWidth="1.6">
            <path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15z" fill="rgba(184,224,106,.2)" />
            <path d="M5 19l8-8" />
          </svg>
          {data.storeName}
        </span>
        <span className="tabular-nums opacity-80">{clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
      </header>

      {current === 'today' && (
        <div className="grid flex-1 grid-cols-3 gap-8">
          <Big label="Vendido hoje" value={formatMoney(data.today.total)} />
          <Big label="Vendas" value={String(data.today.count)} />
          <Big label="Ticket médio" value={formatMoney(data.today.ticket)} />
          {dayPct != null && (
            <div className="col-span-3">
              <p className="mb-3 text-3xl">
                Meta do dia: {formatMoney(data.dayTarget!)} · {Math.round(dayPct * 100)}% {dayPct >= 1 && '🎉 batida!'}
              </p>
              <div className="h-8 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[#B8E06A] transition-all" style={{ width: `${dayPct * 100}%` }} />
              </div>
              {dayPct < 1 && <p className="mt-3 text-2xl opacity-80">Faltam {formatMoney(data.dayTarget! - data.today.total)} hoje</p>}
            </div>
          )}
          <div className="col-span-3 flex h-40 items-end gap-2">
            {Array.from({ length: 15 }, (_, i) => i + 7).map((h) => {
              const v = data.byHour.find((b) => b.hour === h)?.total ?? 0;
              return (
                <div key={h} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <div className="w-full rounded-t bg-[#4F9A5C]" style={{ height: `${(v / maxHour) * 100}%` }} />
                  <span className="text-lg opacity-60">{h}h</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {current === 'goals' && (
        <div className="grid flex-1 grid-cols-2 gap-8">
          {data.goals.slice(0, 6).map((g) => (
            <div key={g.name} className="rounded-3xl bg-white/5 p-8">
              <p className="text-3xl font-semibold">{g.name}</p>
              <p className="mt-2 text-2xl opacity-80">
                {g.unit === 'R$' ? formatMoney(g.actual) : g.actual} de {g.unit === 'R$' ? formatMoney(g.target) : `${g.target} ${g.unit}`}
              </p>
              <div className="mt-4 h-6 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, g.pct * 100)}%`, background: COLOR[g.status] }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {current === 'ranking' && (
        <div className="flex-1">
          <p className="mb-6 text-4xl font-semibold">Ranking de hoje</p>
          {!data.ranking.length ? (
            <p className="text-3xl opacity-60">Ainda sem vendas hoje.</p>
          ) : (
            <ol className="space-y-4 text-4xl">
              {data.ranking.slice(0, 6).map((r, i) => (
                <li key={r.name + i} className="flex justify-between rounded-2xl bg-white/5 px-8 py-5">
                  <span>
                    {['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} {r.name}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(r.total)} <span className="text-2xl opacity-60">· {r.count} vendas</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {current === 'offers' && (
        <div className="flex-1">
          <p className="mb-6 text-5xl font-bold">
            Preço de <span className="text-[#B8E06A]">membro</span>
          </p>
          {!data.offers.length ? (
            <p className="text-3xl opacity-60">Cadastre preços de membro nos produtos para eles aparecerem aqui.</p>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {data.offers.slice(0, 9).map((o) => (
                <div key={o.name} className="rounded-3xl bg-white/5 p-6">
                  <p className="text-2xl">{o.name}</p>
                  <p className="mt-2 text-xl line-through opacity-50">{formatMoney(o.price)}</p>
                  <p className="text-4xl font-bold text-[#B8E06A]">{formatMoney(o.memberPrice)}</p>
                  <p className="mt-1 text-lg opacity-70">−{o.savingPct}% para membro</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {current === 'club' && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-6xl font-bold">Entre no clube. É grátis.</p>
          <p className="mt-6 text-4xl opacity-80">Peça no caixa: só nome e celular.</p>
          <p className="mt-4 text-3xl text-[#B8E06A]">Preço de membro + cashback em toda compra</p>
        </div>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen cursor-none flex-col bg-[#0f1f14] p-12 text-white">{children}</div>;
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-white/5 p-8">
      <p className="text-2xl opacity-70">{label}</p>
      <p className="mt-2 text-6xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
