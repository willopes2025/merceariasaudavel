import { useQuery } from '@tanstack/react-query';
import type { Operation, Store } from '@mercearia/contracts';
import { api, session } from '../lib/api';
import { PageHeader } from '../components/ui';

const PHASES = [
  { n: 0, name: 'Fundação', what: 'Login, permissões, lojas, operações e menu' },
  { n: 1, name: 'Cliente e cadastros', what: 'Clientes com CPF, carga do ssÓtica, Programa Seven' },
  { n: 2, name: 'Receita, orçamento e O.S.', what: 'Exame, receita, O.S. com as 18 etapas' },
  { n: 3, name: 'Venda, caixa e financeiro', what: 'PDV, caixa, crediário com Asaas, cobrança' },
  { n: 4, name: 'Produtos e estoque', what: 'Catálogo, lentes, entrada por XML, inventário' },
  { n: 5, name: 'Fiscal', what: 'NFC-e e NF-e pela Focus NFe; desliga o ssÓtica' },
  { n: 6, name: 'CRM no Mercearia', what: 'Inbox, funis e disparos dentro do Mercearia (WhatsApp próprio)' },
  { n: 7, name: 'Automação, IA e relatórios', what: 'Agentes IA, relatórios, comissões' },
];
const CURRENT = 1;

export function HomeScreen() {
  const user = session.user();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const operations = useQuery({ queryKey: ['operations'], queryFn: () => api<Operation[]>('/operations') });

  return (
    <div className="max-w-5xl">
      <PageHeader title={`Olá, ${user?.name.split(' ')[0] ?? ''}`} subtitle="O Mercearia está sendo construído por fases. Aqui está onde estamos." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <p className="label">Lojas</p>
          <ul className="mt-2 space-y-1 text-sm">
            {stores.data?.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
        </div>
        <div className="card p-5">
          <p className="label">Operações</p>
          <ul className="mt-2 space-y-1 text-sm">
            {operations.data?.map((o) => (
              <li key={o.id} className="flex justify-between gap-2">
                <span>{o.name}</span>
                <span className="text-ink-soft">{o.defaultStoreName ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card p-5">
        <p className="label mb-3">Fases de construção</p>
        <ol className="space-y-2">
          {PHASES.map((p) => (
            <li key={p.n} className="flex items-start gap-3 text-sm">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  p.n < CURRENT ? 'bg-emerald-100 text-emerald-700' : p.n === CURRENT ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {p.n}
              </span>
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="text-ink-soft"> — {p.what}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
