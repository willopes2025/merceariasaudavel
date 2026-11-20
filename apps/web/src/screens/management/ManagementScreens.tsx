import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  GOAL_METRICS,
  GOAL_SCOPES,
  METRICS_BY_SCOPE,
  TV_MODES,
  addDays,
  goalSchema,
  todayBR,
  tvScreenSchema,
  type Category,
  type Dashboard,
  type Goal,
  type GoalMetric,
  type GoalScope,
  type Store,
  type TvScreen,
  type UserRow,
} from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney, formatQty, pct } from '../../components/format';
import { Kpi } from '../kitchen/KitchenScreens';

const STATUS_COLOR = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-red-500' } as const;
const STATUS_LABEL = { green: 'No ritmo', yellow: 'Um pouco atrás', red: 'Longe do ritmo' } as const;

export const goalValue = (metric: GoalMetric, v: number) => (GOAL_METRICS[metric].unit === 'R$' ? formatMoney(v) : GOAL_METRICS[metric].unit === '%' ? pct(v) : `${formatQty(v)} ${GOAL_METRICS[metric].unit}`);

function delta(now: number, before: number) {
  if (!before) return null;
  const d = Math.round(((now - before) / before) * 100);
  return <span className={d >= 0 ? 'text-emerald-600' : 'text-red-600'}>{d >= 0 ? '▲' : '▼'} {Math.abs(d)}% vs. semana passada</span>;
}

/** Painel do dia: vendas, meta, ritmo, alertas de estoque e validade. */
export function DashboardScreen() {
  const user = session.user();
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), enabled: can('report.view'), refetchInterval: 60_000 });
  if (!can('report.view'))
    return (
      <div className="max-w-xl">
        <PageHeader title={`Olá, ${user?.name.split(' ')[0] ?? ''}`} />
        <div className="card space-y-2 p-6 text-sm">
          {can('sale.create') && <Link to="/vender" className="btn-primary">Abrir o caixa (PDV)</Link>}
          {can('stock.loss') && <Link to="/insumos/contagem" className="btn-ghost ml-2">Contagem de insumos</Link>}
        </div>
      </div>
    );
  if (d.isLoading) return <Loading />;
  if (!d.data) return <ErrorBox error={d.error} />;
  const x = d.data;
  const maxHour = Math.max(1, ...x.byHour.map((h) => h.total));
  const monthPct = x.month.target ? x.month.total / x.month.target : null;
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={`Olá, ${user?.name.split(' ')[0] ?? ''}`} subtitle={`Painel de hoje, ${new Date(`${x.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`} action={can('sale.create') && <Link to="/vender" className="btn-primary">Abrir o PDV</Link>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-ink-soft">Vendido hoje</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(x.today.total)}</p>
          <p className="text-xs">{delta(x.today.total, x.lastWeek.total)}</p>
        </div>
        <Kpi label="Vendas · ticket médio" value={`${x.today.count} · ${formatMoney(x.today.ticket)}`} hint={`${formatQty(x.today.itemsPerSale)} itens por venda`} />
        <Kpi label="Faturamento de membros" value={pct(x.today.memberShare)} hint={`${x.today.newMembers} novos membros hoje`} />
        <Kpi label="Perdas no mês (a custo)" value={formatMoney(x.alerts.monthLosses)} tone={x.alerts.monthLosses > 0 ? 'text-red-600' : ''} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Mês: {formatMoney(x.month.total)}</h2>
            <span className="text-sm text-ink-soft">
              {x.month.target ? `meta ${formatMoney(x.month.target)} · ` : ''}projeção {formatMoney(x.month.projection)} · faltam {x.month.daysLeft} dias
            </span>
          </div>
          {monthPct != null ? (
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, monthPct * 100)}%` }} />
            </div>
          ) : (
            can('goal.manage') && <Link to="/metas" className="mt-2 inline-block text-sm text-brand">Definir a meta do mês</Link>
          )}
          <h3 className="mt-5 text-sm font-medium">Vendas por hora (hoje)</h3>
          <div className="mt-2 flex h-32 items-end gap-1">
            {Array.from({ length: 15 }, (_, i) => i + 7).map((h) => {
              const v = x.byHour.find((b) => b.hour === h)?.total ?? 0;
              return (
                <div key={h} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${h}h: ${formatMoney(v)}`}>
                  <div className="w-full rounded-t bg-brand/80" style={{ height: `${(v / maxHour) * 100}%`, minHeight: v ? 2 : 0 }} />
                  <span className="text-[10px] text-ink-soft">{h}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card p-4">
          <h2 className="font-medium">Mais vendidos hoje</h2>
          {!x.topProducts.length ? (
            <p className="mt-2 text-sm text-ink-soft">Nenhuma venda ainda.</p>
          ) : (
            <ol className="mt-2 space-y-1 text-sm">
              {x.topProducts.map((p) => (
                <li key={p.productId} className="flex justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className="tabular-nums text-ink-soft">{formatMoney(p.total)}</span>
                </li>
              ))}
            </ol>
          )}
          <h2 className="mt-4 font-medium">Equipe no mês</h2>
          <ol className="mt-2 space-y-1 text-sm">
            {x.sellers.map((s, i) => (
              <li key={s.userId} className="flex justify-between">
                <span>
                  {i + 1}. {s.name}
                </span>
                <span className="tabular-nums">{formatMoney(s.total)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {x.goals.length > 0 && <GoalBoard goals={x.goals} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="font-medium">Abaixo do mínimo</h2>
          {!x.alerts.lowStock.length ? (
            <p className="mt-2 text-sm text-ink-soft">Tudo acima do mínimo.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {x.alerts.lowStock.map((l) => (
                <li key={l.productId} className="flex justify-between">
                  <span>{l.name}</span>
                  <span className="tabular-nums text-red-600">
                    {formatQty(l.quantity)} / mín. {formatQty(l.minStock, l.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <div className="flex justify-between">
            <h2 className="font-medium">Vencendo em 15 dias</h2>
            <Link to="/validades" className="text-sm text-brand">
              Ver todos
            </Link>
          </div>
          {!x.alerts.expiring.length ? (
            <p className="mt-2 text-sm text-ink-soft">Nenhum lote vencendo.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {x.alerts.expiring.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {l.name} <span className="text-xs text-ink-soft">lote {l.lotCode}</span>
                  </span>
                  <span className={`whitespace-nowrap ${l.daysLeft <= 7 ? 'text-red-600' : 'text-amber-700'}`}>
                    {l.daysLeft < 0 ? 'vencido' : `${l.daysLeft} dias`} · {formatMoney(l.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function GoalBoard({ goals }: { goals: Goal[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {goals.map((g) => (
        <div key={g.id} className="card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{g.name}</p>
              <p className="text-xs text-ink-soft">
                {GOAL_METRICS[g.metric].label}
                {g.refName ? ` · ${g.refName}` : ''}
              </p>
            </div>
            <span className={`mt-1 h-3 w-3 rounded-full ${STATUS_COLOR[g.progress.status]}`} title={STATUS_LABEL[g.progress.status]} />
          </div>
          <p className="mt-2 text-lg font-semibold tabular-nums">
            {goalValue(g.metric, g.progress.actual)} <span className="text-sm font-normal text-ink-soft">de {goalValue(g.metric, g.target)}</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${STATUS_COLOR[g.progress.status]}`} style={{ width: `${Math.min(100, g.progress.pct * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {STATUS_LABEL[g.progress.status]}
            {g.progress.perDayNeeded != null && ` · faltam ${goalValue(g.metric, g.progress.perDayNeeded)} por dia`}
            {g.progress.projection != null && ` · projeção ${goalValue(g.metric, g.progress.projection)}`}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Quadro de metas: por loja, pessoa, categoria ou produto. */
export function GoalsScreen() {
  const client = useQueryClient();
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const goals = useQuery({ queryKey: ['goals', all], queryFn: () => api<Goal[]>(`/goals?status=${all ? 'all' : 'current'}`) });
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Metas"
        subtitle="Faturamento, ticket, itens por venda, novos membros e perda de insumos — da loja, de cada pessoa, de uma categoria ou de um produto."
        action={can('goal.manage') && <button className="btn-primary" onClick={() => setEditing('new')}>Nova meta</button>}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Mostrar também as encerradas e futuras
      </label>
      <ErrorBox error={goals.error} />
      {goals.isLoading ? <Loading /> : !goals.data?.length ? <div className="card"><Empty>Nenhuma meta {all ? '' : 'valendo agora'}.</Empty></div> : <GoalBoard goals={goals.data} />}
      {goals.data && goals.data.length > 0 && can('goal.manage') && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Meta</th>
                <th>Período</th>
                <th className="text-right">Alvo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {goals.data.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.name} {!g.active && <span className="badge bg-slate-100 text-slate-500">Desligada</span>}
                  </td>
                  <td>
                    {new Date(`${g.startDate}T12:00:00`).toLocaleDateString('pt-BR')} a {new Date(`${g.endDate}T12:00:00`).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="text-right">{goalValue(g.metric, g.target)}</td>
                  <td className="text-right">
                    <button className="text-sm text-brand" onClick={() => setEditing(g)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GoalDrawer goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); client.invalidateQueries({ queryKey: ['goals'] }); client.invalidateQueries({ queryKey: ['dashboard'] }); }} />}
    </div>
  );
}

function GoalDrawer({ goal, onClose, onSaved }: { goal: Goal | null; onClose: () => void; onSaved: () => void }) {
  const today = todayBR();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addDays(`${addDays(monthStart, 32).slice(0, 7)}-01`, -1);
  const [f, setF] = useState({
    name: goal?.name ?? '',
    metric: goal?.metric ?? ('faturamento' as GoalMetric),
    scope: goal?.scope ?? ('loja' as GoalScope),
    storeId: goal?.storeId ?? '',
    refId: goal?.refId ?? '',
    startDate: goal?.startDate ?? monthStart,
    endDate: goal?.endDate ?? monthEnd,
    target: goal ? String(goal.target).replace('.', ',') : '',
    active: goal?.active ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users'), enabled: f.scope === 'vendedor' && can('user.manage') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories'), enabled: f.scope === 'categoria' });
  const products = useQuery({ queryKey: ['goal-products'], queryFn: () => api<{ items: Array<{ id: string; name: string }> }>('/products?pageSize=200'), enabled: f.scope === 'produto' });
  const save = useMutation({ mutationFn: (body: unknown) => api(goal ? `/goals/${goal.id}` : '/goals', { method: goal ? 'PUT' : 'POST', json: body }), onSuccess: onSaved, onError: setError });
  const refs = f.scope === 'vendedor' ? users.data?.filter((u) => u.active) : f.scope === 'categoria' ? categories.data : f.scope === 'produto' ? products.data?.items : [];
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = goalSchema.safeParse({ ...f, storeId: f.storeId || null, refId: f.refId || null });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    save.mutate(parsed.data);
  }
  return (
    <Drawer title={goal ? 'Editar meta' : 'Nova meta'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Nome">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Faturamento de dezembro" autoFocus />
        </Field>
        <Field label="De quem">
          <select className="input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as GoalScope, refId: '', metric: METRICS_BY_SCOPE[e.target.value as GoalScope][0]! })}>
            {Object.entries(GOAL_SCOPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {f.scope !== 'loja' && (
          <Field label={f.scope === 'vendedor' ? 'Pessoa' : f.scope === 'categoria' ? 'Categoria' : 'Produto'}>
            <select className="input" value={f.refId} onChange={(e) => setF({ ...f, refId: e.target.value })}>
              <option value="">Escolha…</option>
              {refs?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="O que medir">
          <select className="input" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as GoalMetric })}>
            {METRICS_BY_SCOPE[f.scope].map((m) => (
              <option key={m} value={m}>
                {GOAL_METRICS[m].label}
              </option>
            ))}
          </select>
        </Field>
        {(stores.data?.length ?? 0) > 1 && (
          <Field label="Loja">
            <select className="input" value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}>
              <option value="">Todas</option>
              {stores.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Fim">
            <input type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
        <Field label={`Alvo (${GOAL_METRICS[f.metric].unit})`} hint={GOAL_METRICS[f.metric].higherIsBetter ? undefined : 'Meta de máximo: verde enquanto ficar abaixo.'}>
          <input className="input" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ligada
        </label>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          Salvar meta
        </button>
      </form>
    </Drawer>
  );
}

/** Telas de TV: link fixo que abre o painel sozinho (sem login). */
export function TvScreensScreen() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['tv-screens'], queryFn: () => api<TvScreen[]>('/tv-screens') });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [name, setName] = useState('TV do balcão');
  const [mode, setMode] = useState<'equipe' | 'cliente'>('equipe');
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['tv-screens'] });
  const create = useMutation({ mutationFn: (body: unknown) => api('/tv-screens', { method: 'POST', json: body }), onSuccess: refresh, onError: setError });
  const rotate = useMutation({ mutationFn: (t: TvScreen) => api(`/tv-screens/${t.id}/rotate`, { method: 'POST', json: { storeId: t.storeId, name: t.name, mode: t.mode, active: t.active } }), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: (t: TvScreen) => api(`/tv-screens/${t.id}`, { method: 'PUT', json: { storeId: t.storeId, name: t.name, mode: t.mode, active: !t.active } }), onSuccess: refresh });
  const url = (t: TvScreen) => `${window.location.origin}${t.path}`;
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Telas de TV" subtitle="Cada TV tem um link fixo. Deixe a TV box (ou o mini PC) abrindo esse link ao ligar: o painel aparece sozinho e se atualiza a cada minuto." />
      <form
        className="card flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = tvScreenSchema.safeParse({ storeId: stores.data?.[0]?.id, name, mode });
          if (!parsed.success) return setError(parsed.error.issues[0]?.message);
          create.mutate(parsed.data);
        }}
      >
        <Field label="Nome">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="O que mostra">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'equipe' | 'cliente')}>
            {Object.entries(TV_MODES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn-primary" disabled={create.isPending}>
          Criar tela
        </button>
        <ErrorBox error={error} />
      </form>
      <div className="card overflow-x-auto">
        {!list.data?.length ? (
          <Empty>Nenhuma tela criada.</Empty>
        ) : (
          <table className="table">
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className="font-medium">{t.name}</span> {!t.active && <span className="badge bg-slate-100 text-slate-500">Desligada</span>}
                    <div className="text-xs text-ink-soft">{TV_MODES[t.mode]}</div>
                    <div className="mt-1 break-all font-mono text-xs">{url(t)}</div>
                  </td>
                  <td className="whitespace-nowrap text-right text-sm">
                    <a className="text-brand" href={t.path} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                    <button
                      className="ml-3 text-brand"
                      onClick={() => {
                        navigator.clipboard?.writeText(url(t)).then(() => setCopied(t.id)).catch(() => undefined);
                      }}
                    >
                      {copied === t.id ? 'Copiado' : 'Copiar link'}
                    </button>
                    <button className="ml-3 text-ink-soft" onClick={() => toggle.mutate(t)}>
                      {t.active ? 'Desligar' : 'Ligar'}
                    </button>
                    <button className="ml-3 text-ink-soft" title="O link antigo para de funcionar" onClick={() => rotate.mutate(t)}>
                      Trocar link
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
