import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, formatMoney, todayBR, type Cashflow } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';
import { Stat } from './PayablesScreen';

const SALDO = 'mercearia.fluxo.saldo';
const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Fluxo de caixa: realizado até hoje e previsto (recebíveis e contas a pagar) para os próximos dias. */
export function CashflowScreen() {
  const hoje = todayBR();
  const [de, setDe] = useState(addDays(hoje, -7));
  const [ate, setAte] = useState(addDays(hoje, 30));
  const [saldo, setSaldo] = useState(() => { try { return localStorage.getItem(SALDO) ?? ''; } catch { return ''; } });
  const [soMovimento, setSoMovimento] = useState(true);
  const abertura = Number(saldo.replace(/\./g, '').replace(',', '.')) || 0;
  const q = useQuery({ queryKey: ['fluxo', de, ate, abertura], queryFn: () => api<Cashflow>(`/reports/cashflow?from=${de}&to=${ate}&opening=${abertura}`) });
  const d = q.data;
  const menor = d?.days.reduce((m, x) => (x.balance < m.balance ? x : m), d.days[0]!);
  const maior = Math.max(1, ...(d?.days.map((x) => Math.max(x.inDone + x.inExpected, x.outDone + x.outExpected)) ?? [1]));
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Fluxo de caixa" subtitle="O que entrou e saiu até hoje e o que está previsto: recebíveis (cartão no prazo da maquininha, já sem taxa) e contas a pagar pelo vencimento." />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="De"><input className="input w-40" type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Field>
        <Field label="Até"><input className="input w-40" type="date" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>
        <Field label="Saldo no início (opcional)" hint="Quanto tinha na conta e no caixa no primeiro dia.">
          <input className="input w-40" inputMode="decimal" placeholder="0,00" value={saldo} onChange={(e) => { setSaldo(e.target.value); try { localStorage.setItem(SALDO, e.target.value); } catch { /* sem armazenamento */ } }} />
        </Field>
        <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={soMovimento} onChange={(e) => setSoMovimento(e.target.checked)} /> Só dias com movimento</label>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : d && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Entradas no período" value={formatMoney(d.totals.in)} />
            <Stat label="Saídas no período" value={formatMoney(d.totals.out)} />
            <Stat label="Saldo no fim" value={formatMoney(d.days.at(-1)?.balance ?? d.opening)} alert={(d.days.at(-1)?.balance ?? 0) < 0} />
            <Stat label="Menor saldo" value={menor ? `${formatMoney(menor.balance)} · ${formatDay(menor.date)}` : '—'} alert={!!menor && menor.balance < 0} />
          </div>
          {(d.overdue.receivables > 0 || d.overdue.payables > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Fora do fluxo, em atraso: {formatMoney(d.overdue.receivables)} a receber que não caiu e {formatMoney(d.overdue.payables)} em contas vencidas sem pagar.
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Dia</th><th className="text-right">Entrou</th><th className="text-right">Vai entrar</th><th className="text-right">Saiu</th><th className="text-right">Vai sair</th><th className="w-40" /><th className="text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {d.days.filter((x) => !soMovimento || x.net || x.inDone || x.outDone || x.date === hoje).map((x) => (
                  <tr key={x.date} className={x.date === hoje ? 'bg-brand-soft/60' : x.date > hoje ? '' : 'text-ink-soft'}>
                    <td className="whitespace-nowrap">{formatDay(x.date)} <span className="text-xs text-ink-soft">{DIA[new Date(`${x.date}T12:00:00Z`).getUTCDay()]}{x.date === hoje ? ' · hoje' : ''}</span></td>
                    <td className="text-right">{x.inDone ? formatMoney(x.inDone) : ''}</td>
                    <td className="text-right text-emerald-700">{x.inExpected ? formatMoney(x.inExpected) : ''}</td>
                    <td className="text-right">{x.outDone ? `− ${formatMoney(x.outDone)}` : ''}</td>
                    <td className="text-right text-red-700">{x.outExpected ? `− ${formatMoney(x.outExpected)}` : ''}</td>
                    <td>
                      <div className="flex h-3 flex-col justify-center gap-0.5" aria-hidden="true">
                        <div className="h-1 rounded bg-emerald-500" style={{ width: `${((x.inDone + x.inExpected) / maior) * 100}%` }} />
                        <div className="h-1 rounded bg-red-400" style={{ width: `${((x.outDone + x.outExpected) / maior) * 100}%` }} />
                      </div>
                    </td>
                    <td className={`text-right font-medium ${x.balance < 0 ? 'text-red-700' : ''}`}>{formatMoney(x.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
