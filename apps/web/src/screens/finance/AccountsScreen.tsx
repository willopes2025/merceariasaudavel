import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_KINDS, addDays, formatMoney, todayBR, type AccountEntry, type AccountKind, type FinancialAccount } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';

type Form = { id: string | null; name: string; kind: AccountKind; bank: string; agency: string; number: string; pixKey: string; openingBalance: string; openingDate: string; active: boolean };
const KIND_ICON: Record<string, string> = { caixa: '💵', banco: '🏦', carteira: '📱' };

/** Contas financeiras: caixa da loja, contas bancárias e carteiras, com saldo e extrato. */
export function AccountsScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['contas-financeiras'], queryFn: () => api<FinancialAccount[]>('/financial-accounts') });
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [mov, setMov] = useState<'transferencia' | 'ajuste' | null>(null);
  const gestao = can('finance.manage');
  const contas = q.data ?? [];
  const atual = contas.find((c) => c.id === sel) ?? contas[0];
  const atualizar = () => { qc.invalidateQueries({ queryKey: ['contas-financeiras'] }); qc.invalidateQueries({ queryKey: ['extrato'] }); qc.invalidateQueries({ queryKey: ['fluxo'] }); };
  const editar = (c: FinancialAccount) => setForm({ id: c.id, name: c.name, kind: c.kind, bank: c.bank ?? '', agency: c.agency ?? '', number: c.number ?? '', pixKey: c.pixKey ?? '', openingBalance: String(c.openingBalance).replace('.', ','), openingDate: c.openingDate, active: c.active });
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Contas e bancos"
        subtitle="Onde o dinheiro da loja fica: caixa, contas bancárias e carteiras. Cada pagamento e recebimento entra no extrato da conta; o saldo conta a partir da data do saldo inicial."
        action={gestao ? (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setMov('transferencia')}>Transferir</button>
            <button className="btn-ghost" onClick={() => setMov('ajuste')}>Ajustar saldo</button>
            <button className="btn-primary" onClick={() => setForm({ id: null, name: '', kind: 'banco', bank: '', agency: '', number: '', pixKey: '', openingBalance: '', openingDate: todayBR(), active: true })}>Nova conta</button>
          </div>
        ) : undefined}
      />
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {contas.map((c) => (
              <button key={c.id} onClick={() => setSel(c.id)} className={`card p-4 text-left ${c.id === atual?.id ? 'ring-2 ring-brand' : ''} ${c.active ? '' : 'opacity-60'}`}>
                <div className="text-xs text-ink-soft">{KIND_ICON[c.kind]} {ACCOUNT_KINDS[c.kind]}{c.active ? '' : ' · inativa'}</div>
                <div className="font-medium text-ink">{c.name}</div>
                <div className={`mt-1 font-display text-xl ${c.balance < 0 ? 'text-red-700' : 'text-ink'}`}>{formatMoney(c.balance)}</div>
                {(c.bank || c.number) && <div className="text-xs text-ink-soft">{[c.bank, c.agency && `ag. ${c.agency}`, c.number && `c/c ${c.number}`].filter(Boolean).join(' · ')}</div>}
              </button>
            ))}
            <div className="card flex flex-col justify-center bg-cream/60 p-4">
              <div className="text-xs text-ink-soft">Saldo somado (contas ativas)</div>
              <div className="font-display text-xl text-ink">{formatMoney(contas.filter((c) => c.active).reduce((s, c) => s + c.balance, 0))}</div>
            </div>
          </div>
          {atual && <Extrato conta={atual} gestao={gestao} aoEditar={() => editar(atual)} aoMudar={atualizar} />}
        </>
      )}
      {form && <Editar form={form} onClose={() => setForm(null)} onDone={() => { setForm(null); atualizar(); }} />}
      {mov && <Movimento tipo={mov} contas={contas.filter((c) => c.active)} padrao={atual?.id ?? ''} onClose={() => setMov(null)} onDone={() => { setMov(null); atualizar(); }} />}
    </div>
  );
}

function Extrato({ conta, gestao, aoEditar, aoMudar }: { conta: FinancialAccount; gestao: boolean; aoEditar: () => void; aoMudar: () => void }) {
  const hoje = todayBR();
  const [de, setDe] = useState(addDays(hoje, -30));
  const [ate, setAte] = useState(hoje);
  const q = useQuery({ queryKey: ['extrato', conta.id, de, ate], queryFn: () => api<{ opening: number; closing: number; entries: AccountEntry[] }>(`/financial-accounts/${conta.id}/statement?from=${de}&to=${ate}`) });
  const apagar = useMutation({ mutationFn: (id: string) => api(`/account-entries/${id}`, { method: 'DELETE' }), onSuccess: aoMudar });
  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="font-display text-lg text-ink">Extrato · {conta.name}</h2>
          <div className="text-xs text-ink-soft">Saldo inicial de {formatMoney(conta.openingBalance)} em {formatDay(conta.openingDate)}{conta.pixKey ? ` · Pix ${conta.pixKey}` : ''}</div>
        </div>
        <span className="flex-1" />
        <Field label="De"><input type="date" className="input w-40" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="input w-40" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>
        {gestao && <button className="btn-ghost" onClick={aoEditar}>Editar conta</button>}
      </div>
      <ErrorBox error={q.error ?? apagar.error} />
      {q.isLoading ? <Loading /> : !q.data?.entries.length ? <Empty>Sem lançamentos no período. Saldo: {formatMoney(q.data?.closing ?? conta.balance)}.</Empty> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Data</th><th>Lançamento</th><th className="text-right">Entrou</th><th className="text-right">Saiu</th><th className="text-right">Saldo</th><th /></tr></thead>
            <tbody>
              <tr className="text-ink-soft"><td /><td>Saldo anterior</td><td /><td /><td className="text-right tabular-nums">{formatMoney(q.data.opening)}</td><td /></tr>
              {q.data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap tabular-nums">{formatDay(e.date)}</td>
                  <td>{e.description}<span className="ml-2 text-xs text-ink-soft">{e.kind === 'transferencia' ? 'transferência' : e.kind === 'ajuste' ? 'ajuste' : ''}</span></td>
                  <td className="text-right tabular-nums text-emerald-700">{e.amount > 0 ? formatMoney(e.amount) : ''}</td>
                  <td className="text-right tabular-nums text-red-700">{e.amount < 0 ? formatMoney(-e.amount) : ''}</td>
                  <td className={`text-right tabular-nums font-medium ${e.balance < 0 ? 'text-red-700' : ''}`}>{formatMoney(e.balance)}</td>
                  <td className="text-right text-sm">{gestao && e.manual && <button className="text-ink-soft hover:text-red-600" onClick={() => window.confirm('Apagar este lançamento?') && apagar.mutate(e.id)}>Apagar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Editar({ form, onClose, onDone }: { form: Form; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(form);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const salvar = useMutation({ mutationFn: () => api(f.id ? `/financial-accounts/${f.id}` : '/financial-accounts', { method: f.id ? 'PUT' : 'POST', json: { name: f.name, kind: f.kind, bank: f.bank || null, agency: f.agency || null, number: f.number || null, pixKey: f.pixKey || null, openingBalance: f.openingBalance || '0', openingDate: f.openingDate, active: f.active } }), onSuccess: onDone });
  return (
    <Drawer title={f.id ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Nome"><input className="input" value={f.name} onChange={set('name')} placeholder="Ex.: Banco Inter PJ" autoFocus /></Field>
        <Field label="Tipo">
          <select className="input" value={f.kind} onChange={set('kind')}>{Object.entries(ACCOUNT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        {f.kind !== 'caixa' && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Banco"><input className="input" value={f.bank} onChange={set('bank')} /></Field>
            <Field label="Agência"><input className="input" value={f.agency} onChange={set('agency')} /></Field>
            <Field label="Conta"><input className="input" value={f.number} onChange={set('number')} /></Field>
          </div>
        )}
        <Field label="Chave Pix (opcional)"><input className="input" value={f.pixKey} onChange={set('pixKey')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Saldo inicial (R$)"><input className="input tabular-nums" inputMode="decimal" value={f.openingBalance} onChange={set('openingBalance')} placeholder="0,00" /></Field>
          <Field label="Na data" hint="O saldo conta os lançamentos a partir deste dia."><input type="date" className="input" value={f.openingDate} onChange={set('openingDate')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativa</label>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || f.name.trim().length < 2} onClick={() => salvar.mutate()}>Salvar</button>
      </div>
    </Drawer>
  );
}

function Movimento({ tipo, contas, padrao, onClose, onDone }: { tipo: 'transferencia' | 'ajuste'; contas: FinancialAccount[]; padrao: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ accountId: padrao, toAccountId: '', amount: '', date: todayBR(), description: '', sinal: 'saida' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const valor = Number(f.amount.replace(/\./g, '').replace(',', '.')) || 0;
  const salvar = useMutation({ mutationFn: () => api('/account-moves', { method: 'POST', json: { kind: tipo, accountId: f.accountId, toAccountId: f.toAccountId || undefined, amount: tipo === 'ajuste' && f.sinal === 'saida' ? -valor : valor, date: f.date, description: f.description } }), onSuccess: onDone });
  return (
    <Drawer title={tipo === 'transferencia' ? 'Transferir entre contas' : 'Ajustar saldo'} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">{tipo === 'transferencia' ? 'Ex.: depósito do dinheiro do caixa no banco (sangria), Pix entre contas.' : 'Para acertar o saldo com o extrato do banco. Tarifa, juros e rendimento ficam melhor em contas a pagar/receber (aparecem no DRE).'}</p>
        <Field label={tipo === 'transferencia' ? 'Sai de' : 'Conta'}>
          <select className="input" value={f.accountId} onChange={set('accountId')}>{contas.map((c) => <option key={c.id} value={c.id}>{c.name} · {formatMoney(c.balance)}</option>)}</select>
        </Field>
        {tipo === 'transferencia' ? (
          <Field label="Vai para">
            <select className="input" value={f.toAccountId} onChange={set('toAccountId')}><option value="">Escolha…</option>{contas.filter((c) => c.id !== f.accountId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        ) : (
          <Field label="O saldo">
            <select className="input" value={f.sinal} onChange={set('sinal')}><option value="saida">Diminui (saiu dinheiro)</option><option value="entrada">Aumenta (entrou dinheiro)</option></select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$)"><input className="input tabular-nums" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="0,00" /></Field>
          <Field label="Data"><input type="date" className="input" value={f.date} max={todayBR()} onChange={set('date')} /></Field>
        </div>
        <Field label="Descrição (opcional)"><input className="input" value={f.description} onChange={set('description')} /></Field>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || valor <= 0 || !f.accountId || (tipo === 'transferencia' && !f.toAccountId)} onClick={() => salvar.mutate()}>Confirmar</button>
      </div>
    </Drawer>
  );
}
