import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_KINDS, RECEIVABLE_STATUS, formatMoney, todayBR, type PaymentMethodFees, type Receivable, type ReceivablesSummary } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';
import { Stat } from './PayablesScreen';

const FILTROS = { aberto: 'A receber', vencido: 'Atrasados', recebido: 'Recebidos', cancelado: 'Cancelados', todos: 'Todos' } as const;

/** Contas a receber: o que as vendas no cartão e no app vão render (já sem taxa) e quando cai. */
export function ReceivablesScreen() {
  const [aba, setAba] = useState<'lista' | 'taxas'>('lista');
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Contas a receber" subtitle="Cada venda vira um recebível com a taxa e o prazo da forma de pagamento: Pix e dinheiro caem na hora; cartão cai no prazo da maquininha, já sem a taxa." />
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ['lista', 'Recebíveis'],
            ['taxas', 'Taxas e prazos'],
          ] as const
        ).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === k ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      {aba === 'lista' ? <Lista /> : <Taxas />}
    </div>
  );
}

function Lista() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<keyof typeof FILTROS>('aberto');
  const [busca, setBusca] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [baixa, setBaixa] = useState<Receivable[] | null>(null);
  const [novo, setNovo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => setSel(new Set()), [status, debounced]);
  const params = new URLSearchParams({ status });
  if (debounced) params.set('search', debounced);
  const resumo = useQuery({ queryKey: ['receber', 'resumo'], queryFn: () => api<ReceivablesSummary>('/receivables/summary') });
  const lista = useQuery({ queryKey: ['receber', 'lista', params.toString()], queryFn: () => api<Receivable[]>(`/receivables?${params}`) });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['receber'] });
  const acao = useMutation({ mutationFn: (d: { id: string; a: 'reopen' | 'cancel' }) => api(`/receivables/${d.id}/${d.a}`, { method: 'POST' }), onSettled: atualizar });
  const gestao = can('finance.manage');
  const itens = lista.data ?? [];
  const abertos = itens.filter((r) => r.status === 'aberto');
  const marcados = abertos.filter((r) => sel.has(r.id));
  const hoje = todayBR();
  return (
    <>
      {resumo.data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Cai hoje" value={formatMoney(resumo.data.today)} />
          <Stat label="Próximos 7 dias" value={formatMoney(resumo.data.next7)} />
          <Stat label="Próximos 30 dias" value={formatMoney(resumo.data.next30)} />
          <Stat label="Atrasado (não caiu)" value={formatMoney(resumo.data.overdue)} alert={resumo.data.overdue > 0} />
        </div>
      )}
      {resumo.data && resumo.data.byMethod.length > 0 && (
        <div className="card flex flex-wrap gap-x-6 gap-y-2 px-4 py-3 text-sm">
          {resumo.data.byMethod.map((m) => (
            <span key={m.name}>
              <b>{m.name}</b>: {formatMoney(m.open)} a receber{m.nextDate ? ` · próximo ${formatDay(m.nextDate)}` : ''}
              {m.overdue > 0 && <span className="text-red-700"> · {formatMoney(m.overdue)} atrasado</span>}
            </span>
          ))}
          <span className="text-ink-soft">Taxas pagas no mês: {formatMoney(resumo.data.feesMonth)}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as keyof typeof FILTROS)} aria-label="Situação">
          {Object.entries(FILTROS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input className="input max-w-xs" placeholder="Buscar (ex.: Venda nº 120)" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        <span className="flex-1" />
        {gestao && marcados.length > 0 && (
          <button className="btn-primary" onClick={() => setBaixa(marcados)}>
            Recebi {marcados.length} · {formatMoney(marcados.reduce((s, r) => s + r.net, 0))}
          </button>
        )}
        {gestao && <button className="btn-ghost" onClick={() => setNovo(true)}>Outro recebimento</button>}
      </div>
      <ErrorBox error={lista.error ?? acao.error} />
      <div className="card overflow-x-auto">
        {lista.isLoading ? (
          <Loading />
        ) : !itens.length ? (
          <Empty>Nada aqui.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                {gestao && (
                  <th className="w-8">
                    <input type="checkbox" aria-label="Marcar todos" checked={abertos.length > 0 && marcados.length === abertos.length} onChange={(e) => setSel(e.target.checked ? new Set(abertos.map((r) => r.id)) : new Set())} />
                  </th>
                )}
                <th>Recebível</th>
                <th>Forma</th>
                <th>Venda</th>
                <th>{status === 'recebido' ? 'Recebido em' : 'Cai em'}</th>
                <th className="text-right">Bruto</th>
                <th className="text-right">Taxa</th>
                <th className="text-right">Líquido</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((r) => (
                <tr key={r.id} className={r.status === 'cancelado' ? 'opacity-60' : ''}>
                  {gestao && <td>{r.status === 'aberto' && <input type="checkbox" aria-label={`Marcar ${r.description}`} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />}</td>}
                  <td>
                    <div className="font-medium">{r.description}</div>
                    <div className="text-xs text-ink-soft">{r.channel ?? (r.kind === 'avulso' ? 'Avulso' : '')}{r.note ? ` · ${r.note}` : ''}</div>
                  </td>
                  <td>{r.methodName ?? '—'}</td>
                  <td>{formatDay(r.saleDate)}</td>
                  <td>
                    {r.status === 'recebido' ? formatDay(r.receivedDate) : formatDay(r.dueDate)}
                    {r.status === 'aberto' && r.dueDate < hoje && <span className="badge ml-1 bg-red-50 text-red-700">atrasado</span>}
                    {r.status !== 'aberto' && <span className="ml-1 text-xs text-ink-soft">{RECEIVABLE_STATUS[r.status]}</span>}
                  </td>
                  <td className="text-right">{formatMoney(r.gross)}</td>
                  <td className="text-right text-ink-soft">{r.fee ? `− ${formatMoney(r.fee)}` : '—'}</td>
                  <td className="text-right font-medium">
                    {formatMoney(r.status === 'recebido' && r.receivedAmount != null ? r.receivedAmount : r.net)}
                    {r.status === 'recebido' && r.receivedAmount != null && Math.abs(r.receivedAmount - r.net) > 0.004 && <div className="text-xs text-amber-700">previsto {formatMoney(r.net)}</div>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {gestao && r.status === 'aberto' && <button className="text-sm text-brand hover:underline" onClick={() => setBaixa([r])}>Recebi</button>}
                    {gestao && r.status === 'recebido' && <button className="text-sm text-ink-soft hover:underline" onClick={() => acao.mutate({ id: r.id, a: 'reopen' })}>Desfazer</button>}
                    {gestao && r.status === 'aberto' && r.kind === 'avulso' && <button className="ml-3 text-sm text-red-700 hover:underline" onClick={() => window.confirm('Cancelar este recebimento?') && acao.mutate({ id: r.id, a: 'cancel' })}>Cancelar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-ink-soft">Formas sem “Conferir extrato” dão baixa sozinhas no dia previsto. Venda cancelada antes do dinheiro cair some daqui (venda e estorno se anulam).</p>
      {baixa && <Baixa itens={baixa} onClose={() => setBaixa(null)} onDone={() => { setBaixa(null); setSel(new Set()); atualizar(); }} />}
      {novo && <Novo onClose={() => setNovo(false)} onDone={() => { setNovo(false); atualizar(); }} />}
    </>
  );
}

function Baixa({ itens, onClose, onDone }: { itens: Receivable[]; onClose: () => void; onDone: () => void }) {
  const [data, setData] = useState(todayBR());
  const [valor, setValor] = useState('');
  const [nota, setNota] = useState('');
  const previsto = itens.reduce((s, r) => s + r.net, 0);
  const salvar = useMutation({ mutationFn: () => api('/receivables/settle', { method: 'POST', json: { ids: itens.map((r) => r.id), receivedDate: data, ...(itens.length === 1 && valor.trim() ? { amount: valor } : {}), ...(nota.trim() ? { note: nota.trim() } : {}) } }), onSuccess: onDone });
  return (
    <Drawer title={itens.length === 1 ? `Recebi: ${itens[0]!.description}` : `Recebi ${itens.length} itens`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">Previsto: <b>{formatMoney(previsto)}</b></p>
        <Field label="Data em que caiu na conta"><input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        {itens.length === 1 && (
          <Field label="Valor que caiu (se for diferente)" hint="A diferença fica registrada e aparece no caixa.">
            <input className="input" inputMode="decimal" placeholder={String(previsto.toFixed(2)).replace('.', ',')} value={valor} onChange={(e) => setValor(e.target.value)} />
          </Field>
        )}
        <Field label="Observação (opcional)"><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Confirmar recebimento</button>
      </div>
    </Drawer>
  );
}

function Novo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ description: '', amount: '', dueDate: todayBR(), note: '' });
  const salvar = useMutation({ mutationFn: () => api('/receivables', { method: 'POST', json: { ...f, note: f.note || undefined } }), onSuccess: onDone });
  return (
    <Drawer title="Outro recebimento" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">Para dinheiro que vai entrar e não é venda do caixa (ex.: reembolso, aluguel de espaço, bonificação de fornecedor).</p>
        <Field label="Descrição"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Valor"><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Quando cai"><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Observação (opcional)"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || !f.description.trim() || !f.amount.trim()} onClick={() => salvar.mutate()}>Salvar</button>
      </div>
    </Drawer>
  );
}

function Taxas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['receber', 'taxas'], queryFn: () => api<PaymentMethodFees[]>('/payment-fees') });
  const [f, setF] = useState<PaymentMethodFees[] | null>(null);
  const v = f ?? q.data ?? [];
  const mudou = useMemo(() => !!f && JSON.stringify(f) !== JSON.stringify(q.data), [f, q.data]);
  const salvar = useMutation({ mutationFn: () => api<PaymentMethodFees[]>('/payment-fees', { method: 'PUT', json: { methods: v.map(({ id, feePct, feeFixed, settleDays, reconcile }) => ({ id, feePct, feeFixed, settleDays, reconcile })) } }), onSuccess: () => { setF(null); qc.invalidateQueries({ queryKey: ['receber'] }); qc.invalidateQueries({ queryKey: ['dre'] }); } });
  const gestao = can('finance.manage');
  const mexer = (id: string, campo: keyof PaymentMethodFees, valor: number | boolean) => setF(v.map((m) => (m.id === id ? { ...m, [campo]: valor } : m)));
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Coloque as taxas e prazos do seu contrato com a maquininha e com o Mercado Pago. Ao salvar, o que ainda está a receber é recalculado; o que já caiu não muda.</p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Forma</th><th>Taxa (%)</th><th>Taxa fixa (R$)</th><th>Cai em (dias)</th><th>Conferir extrato</th></tr>
          </thead>
          <tbody>
            {v.map((m) => (
              <tr key={m.id} className={m.active ? '' : 'opacity-60'}>
                <td><div className="font-medium">{m.name}</div><div className="text-xs text-ink-soft">{(PAYMENT_KINDS as Record<string, string>)[m.kind] ?? m.kind}{m.active ? '' : ' · inativa'}</div></td>
                <td><input className="input w-24" type="number" step="0.01" min={0} max={30} disabled={!gestao} aria-label={`Taxa de ${m.name}`} value={m.feePct} onChange={(e) => mexer(m.id, 'feePct', Number(e.target.value))} /></td>
                <td><input className="input w-24" type="number" step="0.01" min={0} disabled={!gestao} aria-label={`Taxa fixa de ${m.name}`} value={m.feeFixed} onChange={(e) => mexer(m.id, 'feeFixed', Number(e.target.value))} /></td>
                <td><input className="input w-20" type="number" min={0} max={365} disabled={!gestao} aria-label={`Prazo de ${m.name}`} value={m.settleDays} onChange={(e) => mexer(m.id, 'settleDays', Math.round(Number(e.target.value)))} /></td>
                <td><input type="checkbox" disabled={!gestao || m.settleDays === 0} aria-label={`Conferir extrato de ${m.name}`} checked={m.reconcile && m.settleDays > 0} onChange={(e) => mexer(m.id, 'reconcile', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft">“Cai em 0 dias” = cai na hora (Pix, dinheiro). Com “Conferir extrato”, o recebível só sai de “A receber” quando alguém marcar “Recebi”; sem ele, baixa sozinho no dia previsto.</p>
      <ErrorBox error={salvar.error} />
      {gestao && <button className="btn-primary" disabled={!mudou || salvar.isPending} onClick={() => salvar.mutate()}>Salvar taxas</button>}
    </div>
  );
}
