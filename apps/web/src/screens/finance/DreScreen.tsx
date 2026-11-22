import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, todayBR, type Dre, type DreEntry, type DreLine, type DreView, type FinanceConfig } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';

const mesAtual = () => todayBR().slice(0, 7);
const limites = (mes: string) => {
  const [y, m] = mes.split('-').map(Number) as [number, number];
  const fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const hoje = todayBR();
  return { from: `${mes}-01`, to: fim > hoje && mes === hoje.slice(0, 7) ? hoje : fim };
};
const pct = (v: number, base: number) => (base ? `${((v / base) * 100).toFixed(1).replace('.', ',')}%` : '—');
const varia = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toFixed(0)}%` : '');

/** DRE gerencial em árvore: grupo → conta → detalhe, com % da receita, % dentro do grupo e os lançamentos de cada conta. */
export function DreScreen() {
  const [view, setView] = useState<DreView>('competencia');
  const [mes, setMes] = useState(mesAtual());
  const [periodo, setPeriodo] = useState<{ from: string; to: string } | null>(null);
  const [porCanal, setPorCanal] = useState(false);
  const [zeradas, setZeradas] = useState(false);
  const [config, setConfig] = useState(false);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [conta, setConta] = useState<DreLine | null>(null);
  const p = periodo ?? limites(mes);
  const q = useQuery({ queryKey: ['dre', view, p.from, p.to], queryFn: () => api<Dre>(`/reports/dre?view=${view}&from=${p.from}&to=${p.to}`) });
  const d = q.data;
  const colunas = d ? (porCanal ? d.columns : d.columns.filter((c) => c.key === 'total')) : [];
  const base = d?.lines.find((l) => l.key === (view === 'caixa' ? 'entradas' : 'receita_liquida'))?.values ?? {};
  const linhas = d?.lines ?? [];
  const porChave = new Map(linhas.map((l) => [l.key, l]));
  // Pai de cada linha: o "parent" explícito, ou o grupo (nível 1) que vem antes dela.
  const pai = new Map<string, string>();
  let grupo = '';
  for (const l of linhas) {
    if (l.level === 1) grupo = l.key;
    if (l.level === 0) grupo = '';
    if (l.parent) pai.set(l.key, l.parent);
    else if (l.level === 2 && grupo) pai.set(l.key, grupo);
  }
  const temFilhos = new Set(pai.values());
  const vazia = (l: DreLine) => !Object.values(l.values).some((v) => Math.abs(v) > 0.004) && !(d?.previous.values[l.key]);
  const visivel = (l: DreLine): boolean => {
    if (l.level <= 1) return true;
    if (!zeradas && vazia(l)) return false;
    const p1 = pai.get(l.key);
    if (!p1 || !abertas.has(p1)) return false;
    const avo = porChave.get(p1);
    return avo ? visivel(avo) || avo.level <= 1 : true;
  };
  const alternar = (k: string) => setAbertas((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const abrirTudo = () => setAbertas(abertas.size ? new Set() : new Set(temFilhos));
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="DRE" subtitle="Resultado do negócio, do faturamento ao lucro. Abra cada grupo para ver as contas, quanto cada uma representa e os lançamentos por trás. Competência = pela data da venda e do mês da despesa; caixa = pelo dia em que o dinheiro entrou ou saiu." action={can('finance.manage') ? <button className="btn-ghost" onClick={() => setConfig(!config)}>Configurar</button> : undefined} />
      {config && <Configurar onClose={() => setConfig(false)} />}
      <div className="flex flex-wrap items-end gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="tablist" aria-label="Visão">
          {(
            [
              ['competencia', 'Competência'],
              ['caixa', 'Caixa'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === k ? 'bg-brand text-white' : 'text-ink-soft'}`}>{t}</button>
          ))}
        </div>
        <Field label="Mês"><input className="input w-40" type="month" value={mes} onChange={(e) => { setMes(e.target.value || mesAtual()); setPeriodo(null); }} /></Field>
        <Field label="Ou de"><input className="input w-40" type="date" value={p.from} onChange={(e) => e.target.value && setPeriodo({ from: e.target.value, to: p.to })} /></Field>
        <Field label="até"><input className="input w-40" type="date" value={p.to} onChange={(e) => e.target.value && setPeriodo({ from: p.from, to: e.target.value })} /></Field>
        <button className="btn-ghost mb-0.5" onClick={abrirTudo}>{abertas.size ? 'Fechar tudo' : 'Abrir tudo'}</button>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={porCanal} onChange={(e) => setPorCanal(e.target.checked)} /> Por canal</label>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={zeradas} onChange={(e) => setZeradas(e.target.checked)} /> Contas zeradas</label>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : d && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="min-w-[300px]">{formatDay(d.from)} a {formatDay(d.to)}</th>
                {colunas.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}
                {!porCanal && <th className="text-right" title={`Quanto representa da ${view === 'caixa' ? 'entrada de caixa' : 'receita líquida'}`}>% receita</th>}
                {!porCanal && <th className="text-right" title="Quanto representa dentro do grupo de cima">% no grupo</th>}
                {!porCanal && <th className="text-right">Período anterior</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.filter(visivel).map((l) => {
                const total = l.values.total ?? 0;
                const valor = (v: number) => (l.level === 0 ? formatMoney(v) : `${l.sign < 0 && v > 0 ? '− ' : ''}${formatMoney(l.sign < 0 ? Math.abs(v) : v)}`);
                const abre = temFilhos.has(l.key);
                const acima = porChave.get(pai.get(l.key) ?? '');
                const ant = d.previous.values[l.key] ?? 0;
                return (
                  <tr key={l.key} className={l.level === 0 ? 'bg-cream/70 font-semibold' : l.level === 1 ? 'font-medium' : l.level === 3 ? 'text-sm' : ''}>
                    <td style={{ paddingLeft: `${[12, 12, 34, 58][l.level]}px` }} className={l.level >= 2 ? 'text-ink-soft' : ''}>
                      {abre ? (
                        <button className="inline-flex items-center gap-1.5 text-left hover:text-brand" aria-expanded={abertas.has(l.key)} onClick={() => alternar(l.key)}>
                          <span className="inline-block w-3 text-xs text-ink-soft">{abertas.has(l.key) ? '▾' : '▸'}</span>
                          {l.code && <span className="tabular-nums text-xs text-ink-soft">{l.code}</span>} {l.label}
                        </button>
                      ) : l.accountId ? (
                        <button className="inline-flex items-center gap-1.5 text-left underline decoration-dotted underline-offset-2 hover:text-brand" title="Ver os lançamentos" onClick={() => setConta(l)}>
                          <span className="inline-block w-3" />{l.code && <span className="tabular-nums text-xs">{l.code}</span>} {l.label}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">{l.level > 0 && <span className="inline-block w-3" />}{l.label}</span>
                      )}
                      {l.allocated && porCanal ? <span className="ml-1 text-ink-soft" title="Rateado entre os canais pela receita">÷</span> : null}
                    </td>
                    {colunas.map((c) => {
                      const v = l.values[c.key] ?? 0;
                      return <td key={c.key} className={`text-right tabular-nums ${l.level === 0 && v < 0 ? 'text-red-700' : ''}`}>{valor(v)}{porCanal && l.level === 0 && c.key !== 'total' && <div className="text-[11px] font-normal text-ink-soft">{pct(v, base[c.key] ?? 0)}</div>}</td>;
                    })}
                    {!porCanal && <td className="text-right tabular-nums text-ink-soft">{pct(total, base.total ?? 0)}</td>}
                    {!porCanal && <td className="text-right tabular-nums text-ink-soft">{acima && l.level >= 2 ? pct(Math.abs(total), Math.abs(acima.values.total ?? 0)) : ''}</td>}
                    {!porCanal && (
                      <td className="text-right tabular-nums text-ink-soft">
                        {valor(ant)}
                        {l.level < 2 && ant ? <span className="ml-1 text-xs">{varia(total, ant)}</span> : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {d && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-ink-soft">
          {d.notes.map((n) => <li key={n}>{n}</li>)}
          <li>Período anterior: {formatDay(d.previous.from)} a {formatDay(d.previous.to)}. Linhas sublinhadas abrem os lançamentos. As contas vêm do Plano de contas.</li>
        </ul>
      )}
      {conta && d && <Lancamentos conta={conta} dre={d} onClose={() => setConta(null)} />}
    </div>
  );
}

function Lancamentos({ conta, dre, onClose }: { conta: DreLine; dre: Dre; onClose: () => void }) {
  const q = useQuery({ queryKey: ['dre', 'lancamentos', conta.accountId, dre.view, dre.from, dre.to], queryFn: () => api<DreEntry[]>(`/reports/dre/entries?accountId=${conta.accountId}&view=${dre.view}&from=${dre.from}&to=${dre.to}`) });
  const total = (q.data ?? []).reduce((s, e) => s + (e.kind === 'pagar' ? e.amount : -e.amount), 0);
  return (
    <Drawer title={`${conta.code ?? ''} ${conta.label}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-ink-soft">{formatDay(dre.from)} a {formatDay(dre.to)} · visão de {dre.view === 'caixa' ? 'caixa (data do pagamento)' : 'competência'}</p>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <p className="text-sm text-ink-soft">Nenhum lançamento nesta conta no período.</p> : (
        <table className="table">
          <thead><tr><th>Data</th><th>Lançamento</th><th>Situação</th><th className="text-right">Valor</th><th className="text-right">%</th></tr></thead>
          <tbody>
            {q.data.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap tabular-nums">{formatDay(e.date)}</td>
                <td>{e.description}{e.who && <div className="text-xs text-ink-soft">{e.who}</div>}</td>
                <td className="text-sm text-ink-soft">{e.status}</td>
                <td className="text-right tabular-nums">{e.kind === 'receber' ? '+ ' : ''}{formatMoney(e.amount)}</td>
                <td className="text-right tabular-nums text-ink-soft">{pct(e.amount, Math.abs(total))}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td /><td>Total</td><td /><td className="text-right tabular-nums">{formatMoney(Math.abs(total))}</td><td /></tr>
          </tbody>
        </table>
      )}
    </Drawer>
  );
}

function Configurar({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['dre', 'config'], queryFn: () => api<FinanceConfig>('/finance/config') });
  const [imposto, setImposto] = useState<string | null>(null);
  const salvar = useMutation({ mutationFn: () => api('/finance/config', { method: 'PUT', json: { impostoPct: Number((imposto ?? '0').replace(',', '.')) || 0 } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['dre'] }); onClose(); } });
  if (cfg.isLoading) return <Loading />;
  const v = imposto ?? String(cfg.data?.impostoPct ?? 0).replace('.', ',');
  return (
    <div className="card space-y-3 p-4">
      <Field label="Alíquota de impostos sobre as vendas (%)" hint="Ex.: a alíquota efetiva do Simples Nacional da loja (peça ao contador). Com ela, o DRE por competência estima os impostos do mês sobre o faturamento. Deixe 0 para usar os impostos lançados em contas a pagar.">
        <input className="input w-32" inputMode="decimal" value={v} onChange={(e) => setImposto(e.target.value)} />
      </Field>
      <ErrorBox error={salvar.error} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</button>
        <button className="btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}
