import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, formatMoney, todayBR, type Dre, type DreView, type FinanceConfig } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
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

/** DRE gerencial: competência (quando vendeu) ou caixa (quando o dinheiro entrou/saiu), total ou por canal. */
export function DreScreen() {
  const [view, setView] = useState<DreView>('competencia');
  const [mes, setMes] = useState(mesAtual());
  const [periodo, setPeriodo] = useState<{ from: string; to: string } | null>(null);
  const [porCanal, setPorCanal] = useState(false);
  const [config, setConfig] = useState(false);
  const p = periodo ?? limites(mes);
  const q = useQuery({ queryKey: ['dre', view, p.from, p.to], queryFn: () => api<Dre>(`/reports/dre?view=${view}&from=${p.from}&to=${p.to}`) });
  const d = q.data;
  const colunas = d ? (porCanal ? d.columns : d.columns.filter((c) => c.key === 'total')) : [];
  const base = d?.lines.find((l) => l.key === (view === 'caixa' ? 'entradas' : 'receita_liquida'))?.values ?? {};
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="DRE" subtitle="Resultado do negócio: receitas, deduções, custos e despesas até o lucro. Compare pela data da venda (competência) ou pela data em que o dinheiro entrou e saiu (caixa)." action={can('finance.manage') ? <button className="btn-ghost" onClick={() => setConfig(!config)}>Configurar</button> : undefined} />
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
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={porCanal} onChange={(e) => setPorCanal(e.target.checked)} /> Por canal de venda</label>
        <button className="btn-ghost mb-0.5" onClick={() => setPeriodo({ from: addDays(p.from, -365), to: addDays(p.to, -365) })} title="Mesmo período no ano passado">Ano anterior</button>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : d && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="min-w-[260px]">{formatDay(d.from)} a {formatDay(d.to)}</th>
                {colunas.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}
                {!porCanal && <th className="text-right">%</th>}
                {!porCanal && <th className="text-right">Período anterior</th>}
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => {
                const zero = colunas.every((c) => !l.values[c.key]) && !d.previous.values[l.key];
                if (zero && l.level === 2) return null;
                const total = l.values.total ?? 0;
                const valor = (v: number) => (l.level === 0 ? formatMoney(v) : `${l.sign < 0 && v ? '− ' : ''}${formatMoney(Math.abs(v))}`);
                return (
                  <tr key={l.key} className={l.level === 0 ? 'bg-cream/70 font-semibold' : l.level === 1 ? 'font-medium' : ''}>
                    <td className={l.level === 2 ? 'pl-8 text-ink-soft' : ''}>{l.label}{l.allocated && porCanal ? <span className="ml-1 text-ink-soft" title="Rateado entre os canais pela receita">÷</span> : null}</td>
                    {colunas.map((c) => {
                      const v = l.values[c.key] ?? 0;
                      return <td key={c.key} className={`text-right ${l.level === 0 && v < 0 ? 'text-red-700' : ''}`}>{valor(v)}{porCanal && l.level === 0 && c.key !== 'total' && <div className="text-[11px] font-normal text-ink-soft">{pct(v, base[c.key] ?? 0)}</div>}</td>;
                    })}
                    {!porCanal && <td className="text-right text-ink-soft">{pct(total, base.total ?? 0)}</td>}
                    {!porCanal && (
                      <td className="text-right text-ink-soft">
                        {valor(d.previous.values[l.key] ?? 0)}
                        {l.level < 2 && d.previous.values[l.key] ? <span className="ml-1 text-xs">{varia(total, d.previous.values[l.key]!)}</span> : null}
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
          <li>% sobre a {view === 'caixa' ? 'entrada de caixa' : 'receita líquida'}. Período anterior: {formatDay(d.previous.from)} a {formatDay(d.previous.to)}.</li>
        </ul>
      )}
    </div>
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
