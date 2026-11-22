import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, formatMoney, todayBR, type BankLine, type BankLineAction, type ChartAccount, type FinancialAccount, type Reconciliation } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';

const COR: Record<BankLine['status'], string> = { pendente: 'bg-amber-100 text-amber-800', conciliado: 'bg-emerald-100 text-emerald-800', ignorado: 'bg-slate-100 text-slate-600' };

/** Conciliação bancária: sobe o extrato do banco (OFX) e confere linha a linha com o extrato do sistema. */
export function ReconcileScreen() {
  const qc = useQueryClient();
  const hoje = todayBR();
  const contas = useQuery({ queryKey: ['contas-financeiras'], queryFn: () => api<FinancialAccount[]>('/financial-accounts') });
  const bancos = (contas.data ?? []).filter((c) => c.active && c.kind !== 'caixa');
  const [conta, setConta] = useState('');
  const id = conta || bancos[0]?.id || '';
  const [de, setDe] = useState(addDays(hoje, -30));
  const [ate, setAte] = useState(hoje);
  const [filtro, setFiltro] = useState<'pendente' | 'todas'>('pendente');
  const [lancar, setLancar] = useState<BankLine | null>(null);
  const [aviso, setAviso] = useState('');
  const arquivo = useRef<HTMLInputElement>(null);
  const gestao = can('finance.manage');
  const q = useQuery({ queryKey: ['conciliacao', id, de, ate], queryFn: () => api<Reconciliation>(`/financial-accounts/${id}/reconciliation?from=${de}&to=${ate}`), enabled: !!id });
  const atualizar = () => { qc.invalidateQueries({ queryKey: ['conciliacao'] }); qc.invalidateQueries({ queryKey: ['contas-financeiras'] }); qc.invalidateQueries({ queryKey: ['extrato'] }); };
  const subir = useMutation({
    mutationFn: async (f: File) => api<{ read: number; added: number; matched: number }>(`/financial-accounts/${id}/ofx`, { method: 'POST', json: { content: await f.text() } }),
    onSuccess: (r) => { setAviso(`${r.read} linhas lidas, ${r.added} novas, ${r.matched} conciliadas sozinhas.`); atualizar(); },
  });
  const agir = useMutation({ mutationFn: (p: { id: string; a: BankLineAction }) => api(`/bank-lines/${p.id}`, { method: 'POST', json: p.a }), onSuccess: atualizar });
  const linhas = (q.data?.lines ?? []).filter((l) => filtro === 'todas' || l.status === 'pendente');
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Conciliação bancária"
        subtitle="Baixe o extrato no site ou app do banco em formato OFX e suba aqui. O sistema casa sozinho o que tem o mesmo valor e data próxima; o resto você resolve linha a linha."
        action={gestao && id ? (
          <>
            <input ref={arquivo} type="file" accept=".ofx,.OFX,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subir.mutate(f); e.target.value = ''; }} />
            <button className="btn-primary" disabled={subir.isPending} onClick={() => arquivo.current?.click()}>{subir.isPending ? 'Lendo…' : 'Subir extrato (OFX)'}</button>
          </>
        ) : undefined}
      />
      <ErrorBox error={contas.error ?? q.error ?? subir.error ?? agir.error} />
      {aviso && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</div>}
      {contas.isLoading ? <Loading /> : !bancos.length ? <Empty>Cadastre uma conta bancária em "Contas e bancos" para conciliar.</Empty> : (
        <>
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <Field label="Conta"><select className="input w-56" value={id} onChange={(e) => setConta(e.target.value)}>{bancos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="De"><input type="date" className="input w-40" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Field>
            <Field label="Até"><input type="date" className="input w-40" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>
            <Field label="Mostrar"><select className="input w-40" value={filtro} onChange={(e) => setFiltro(e.target.value as 'pendente' | 'todas')}><option value="pendente">Só pendentes</option><option value="todas">Todas</option></select></Field>
            <span className="flex-1" />
            {q.data && <div className="text-sm text-ink-soft"><b className="text-amber-700">{q.data.pending}</b> pendentes · <b className="text-emerald-700">{q.data.matched}</b> conciliadas · {q.data.ignored} ignoradas</div>}
          </div>
          <div className="card">
            {q.isLoading ? <Loading /> : !q.data?.lines.length ? <Empty>Nenhuma linha do banco neste período. Suba o extrato em OFX.</Empty> : !linhas.length ? <Empty>Tudo conciliado neste período. 🎉</Empty> : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Data</th><th>No banco</th><th className="text-right">Valor</th><th>Situação</th><th>No sistema</th></tr></thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.id} className="align-top">
                        <td className="whitespace-nowrap tabular-nums">{formatDay(l.date)}</td>
                        <td className="max-w-xs">{l.memo || '—'}</td>
                        <td className={`whitespace-nowrap text-right tabular-nums font-medium ${l.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatMoney(l.amount)}</td>
                        <td><span className={`rounded-full px-2 py-0.5 text-xs ${COR[l.status]}`}>{l.status}</span></td>
                        <td className="space-y-1 text-sm">
                          {l.entry && <div>{l.entry.description} <span className="text-ink-soft">· {formatDay(l.entry.date)}</span></div>}
                          {gestao && l.status === 'pendente' && (
                            <>
                              {l.entryOptions.map((e) => <button key={e.id} className="block text-left text-brand hover:underline" onClick={() => agir.mutate({ id: l.id, a: { action: 'match', entryId: e.id } })}>↔ Casar com: {e.description} ({formatDay(e.date)})</button>)}
                              {l.payableOptions.map((p) => <button key={p.id} className="block text-left text-brand hover:underline" onClick={() => agir.mutate({ id: l.id, a: { action: 'pay', payableId: p.id } })}>✓ Baixar a conta: {p.description} (vence {formatDay(p.dueDate)})</button>)}
                              <div className="flex gap-3">
                                <button className="text-brand hover:underline" onClick={() => setLancar(l)}>+ Lançar no sistema</button>
                                <button className="text-ink-soft hover:underline" onClick={() => agir.mutate({ id: l.id, a: { action: 'ignore' } })}>Ignorar</button>
                              </div>
                            </>
                          )}
                          {gestao && l.status !== 'pendente' && <button className="text-ink-soft hover:underline" onClick={() => agir.mutate({ id: l.id, a: { action: 'undo' } })}>Desfazer</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!!q.data?.missingInBank.length && (
            <div className="card p-4">
              <h2 className="font-display text-lg text-ink">No sistema, mas não no banco</h2>
              <p className="mb-2 text-sm text-ink-soft">Lançamentos desta conta no período que não apareceram no extrato do banco. Pode ser data errada, conta errada ou algo que não aconteceu.</p>
              <table className="table">
                <tbody>
                  {q.data.missingInBank.map((e) => (
                    <tr key={e.id}><td className="whitespace-nowrap tabular-nums">{formatDay(e.date)}</td><td>{e.description}</td><td className={`text-right tabular-nums ${e.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatMoney(e.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {lancar && <Lancar linha={lancar} onClose={() => setLancar(null)} onDone={() => { setLancar(null); atualizar(); }} />}
    </div>
  );
}

function Lancar({ linha, onClose, onDone }: { linha: BankLine; onClose: () => void; onDone: () => void }) {
  const plano = useQuery({ queryKey: ['plano-de-contas'], queryFn: () => api<ChartAccount[]>('/chart-accounts') });
  const [conta, setConta] = useState('');
  const [descricao, setDescricao] = useState(linha.memo);
  const saida = linha.amount < 0;
  const opcoes = (plano.data ?? []).filter((c) => c.active && !c.group && (saida ? !['receita', 'financeira_receita'].includes(c.dreLine) : ['receita', 'financeira_receita', 'fora'].includes(c.dreLine)));
  const salvar = useMutation({ mutationFn: () => api(`/bank-lines/${linha.id}`, { method: 'POST', json: { action: 'create', chartAccountId: conta || null, description: descricao } }), onSuccess: onDone });
  return (
    <Drawer title={saida ? 'Lançar saída' : 'Lançar entrada'} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg bg-cream/60 p-3 text-sm">{formatDay(linha.date)} · <b>{formatMoney(linha.amount)}</b><div className="text-ink-soft">{linha.memo}</div></div>
        <Field label="Descrição"><input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        <Field label="Conta do plano de contas" hint={saida ? 'Com conta, vira uma despesa paga e entra no DRE. Sem conta, é só um ajuste de saldo (ex.: tarifa já lançada de outro jeito).' : 'Com conta, vira um recebimento e entra no DRE. Venda no cartão ou Pix NÃO se lança aqui: ela já está em Contas a receber.'}>
          <select className="input" value={conta} onChange={(e) => setConta(e.target.value)}>
            <option value="">Sem conta (só ajusta o saldo)</option>
            {opcoes.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
          </select>
        </Field>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Lançar e conciliar</button>
      </div>
    </Drawer>
  );
}
