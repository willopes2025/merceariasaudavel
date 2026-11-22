import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatMoney, todayBR, type SellerCommissionRow } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { pct } from '../../components/format';

/** Comissão da equipe: vendas de cada pessoa no caixa e o percentual do cadastro de funcionário. */
export function CommissionScreen() {
  const hoje = todayBR();
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje);
  const q = useQuery({ queryKey: ['comissao-vendedor', de, ate], queryFn: () => api<SellerCommissionRow[]>(`/reports/seller-commission?from=${de}&to=${ate}`), enabled: de <= ate });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Comissões da equipe" subtitle="Quanto cada pessoa vendeu no caixa e a comissão pelo percentual do cadastro. Venda cancelada e taxa de entrega não contam." />
      <ErrorBox error={q.error} />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="De"><input type="date" className="input w-40" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="input w-40" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>
      </div>
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : !rows.length ? <Empty>Sem vendas no período.</Empty> : (
          <table className="table">
            <thead><tr><th>Pessoa</th><th className="text-right">Vendas</th><th className="text-right">Total vendido</th><th className="text-right">Participação</th><th className="text-right">%</th><th className="text-right">Comissão</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>{r.name}{!r.employeeId && <span className="ml-2 text-xs text-amber-700">sem cadastro de funcionário</span>}</td>
                  <td className="text-right tabular-nums">{r.sales}</td>
                  <td className="text-right tabular-nums">{formatMoney(r.total)}</td>
                  <td className="text-right tabular-nums">{total ? pct((r.total / total) * 100) : '—'}</td>
                  <td className="text-right tabular-nums">{r.pct ? pct(r.pct) : '—'}</td>
                  <td className="text-right tabular-nums font-medium">{formatMoney(r.commission)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-medium"><td>Total</td><td className="text-right tabular-nums">{rows.reduce((s, r) => s + r.sales, 0)}</td><td className="text-right tabular-nums">{formatMoney(total)}</td><td /><td /><td className="text-right tabular-nums">{formatMoney(rows.reduce((s, r) => s + r.commission, 0))}</td></tr>
            </tbody>
          </table>
        )}
      </div>
      <p className="text-sm text-ink-soft">O percentual de cada pessoa fica em <Link className="text-brand hover:underline" to="/funcionarios">Funcionários</Link> (campo "Comissão sobre vendas"), e o funcionário precisa estar ligado ao usuário que vende no caixa. Para pagar, lance em Contas a pagar na conta de salários e comissões.</p>
    </div>
  );
}
