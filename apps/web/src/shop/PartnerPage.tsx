import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { formatMoney, type PartnerPortal } from '@mercearia/contracts';
import { ApiError } from '../lib/api';
import { Leaf, Spinner } from './parts';

const client = new QueryClient({ defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3 } } });
const BASE_URL = import.meta.env.VITE_API_URL ?? '/v1';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

async function load(token: string): Promise<PartnerPortal> {
  const res = await fetch(`${BASE_URL}/partner-portal/${token}`);
  if (!res.ok) throw new ApiError('ERROR', 'Link inválido.', res.status);
  return (await res.json()) as PartnerPortal;
}

/** Painel do parceiro (/parceiro/<token>): link de indicação, clientes e comissão por mês. */
export function PartnerPage({ token }: { token: string }) {
  return (
    <QueryClientProvider client={client}>
      <Portal token={token} />
    </QueryClientProvider>
  );
}

function Portal({ token }: { token: string }) {
  const q = useQuery({ queryKey: ['portal'], queryFn: () => load(token) });
  useEffect(() => {
    document.title = 'Painel do parceiro';
  }, []);
  if (q.isLoading) return <Spinner />;
  if (!q.data)
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <Leaf className="mx-auto h-10 w-10" />
        <p className="mt-4 font-semibold">Link inválido ou desativado.</p>
        <p className="text-sm text-slate-500">Peça um link novo para a loja.</p>
      </div>
    );
  const p = q.data;
  const signup = `${window.location.origin}${p.signupPath}`;
  const current = p.months[0]!;
  const share = `Cadastre-se no app da ${p.storeName} pelo meu link${p.customerDiscountPct ? ` e ganhe ${String(p.customerDiscountPct).replace('.', ',')}% de desconto com o código ${p.code}` : ''}: ${signup}`;
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-12 text-slate-800">
      <header className="flex items-center gap-3 pt-2">
        <Leaf className="h-9 w-9" />
        <div>
          <p className="text-xs text-slate-500">{p.storeName} · painel do parceiro</p>
          <h1 className="text-lg font-bold">Olá, {p.name.split(' ')[0]}!</h1>
        </div>
      </header>
      <section className="rounded-2xl bg-emerald-700 p-4 text-white">
        <p className="text-sm opacity-80">Seu código</p>
        <p className="font-mono text-3xl font-bold tracking-wider">{p.code}</p>
        <p className="mt-1 text-sm opacity-90">
          {p.customerDiscountPct ? `Sua cliente ganha ${String(p.customerDiscountPct).replace('.', ',')}% de desconto. ` : ''}Você ganha {String(p.commissionPct).replace('.', ',')}% de tudo que ela comprar.
        </p>
        <div className="mt-3 flex gap-2">
          <a className="flex-1 rounded-xl bg-white py-2 text-center font-semibold text-emerald-800" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer">
            Compartilhar no WhatsApp
          </a>
          <button className="rounded-xl border border-white/60 px-3 py-2 text-sm" onClick={() => navigator.clipboard?.writeText(signup)}>
            Copiar link
          </button>
        </div>
      </section>
      <section className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-100 p-3">
          <p className="text-2xl font-bold">{current.customers}</p>
          <p className="text-xs text-slate-500">clientes</p>
        </div>
        <div className="rounded-xl bg-slate-100 p-3">
          <p className="text-2xl font-bold">{current.sales}</p>
          <p className="text-xs text-slate-500">compras no mês</p>
        </div>
        <div className="rounded-xl bg-slate-100 p-3">
          <p className="text-xl font-bold">{formatMoney(current.commission)}</p>
          <p className="text-xs text-slate-500">comissão no mês</p>
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Mês a mês</h2>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {p.months.map((m) => (
            <div key={m.month} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="capitalize">{monthName(m.month)}</span>
              <span className="text-slate-500">
                {m.sales} compras · {formatMoney(m.revenue)}
              </span>
              <span className="font-semibold">
                {formatMoney(m.commission)}
                {m.closed && <span className="ml-1 text-xs font-normal text-emerald-700">fechado</span>}
              </span>
            </div>
          ))}
        </div>
      </section>
      {p.kits.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Seus kits</h2>
          <div className="space-y-2">
            {p.kits.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <span>{k.name}</span>
                <button className="text-emerald-700" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${k.path}`)}>
                  Copiar link
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-2 font-semibold">Suas clientes ({p.customers.length})</h2>
        {!p.customers.length ? (
          <p className="text-sm text-slate-500">Ainda ninguém. Compartilhe seu link ou peça para a cliente falar o código no caixa.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {p.customers.map((c, n) => (
              <div key={n} className="flex justify-between px-3 py-2">
                <span>{c.firstName}</span>
                <span className="text-slate-500">
                  desde {c.since.split('-').reverse().join('/')} · {c.purchases} {c.purchases === 1 ? 'compra' : 'compras'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
