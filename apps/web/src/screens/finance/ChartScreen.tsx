import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DRE_GROUPS, type ChartAccount, type DreGroup } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';

/** Linhas do DRE que o sistema calcula sozinho pelas vendas (não precisam de lançamento). */
const AUTOMATICAS: Record<string, string[]> = {
  receita: ['Vendas de mercadorias (por categoria de produto)', 'Taxas de entrega'],
  deducao: ['Preço de membro', 'Ofertas e promoções', 'Cupons', 'Desconto de parceiros', 'Descontos no caixa', 'Impostos estimados pela alíquota (se configurada)'],
  custo: ['Custo das mercadorias vendidas (CMV)', 'Perdas e acertos de estoque'],
  despesa_venda: ['Taxas de cartão, Pix e app (por forma de pagamento)', 'Comissão de parceiros', 'Cashback concedido'],
};

type Form = { id: string | null; code: string; name: string; dreLine: DreGroup; cashOnly: boolean; active: boolean };

/** Plano de contas: as contas onde cada despesa ou receita é lançada e onde ela aparece no DRE. */
export function ChartScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['chart'], queryFn: () => api<ChartAccount[]>('/chart-accounts') });
  const [form, setForm] = useState<Form | null>(null);
  const gestao = can('finance.manage');
  const apagar = useMutation({ mutationFn: (id: string) => api(`/chart-accounts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['chart'] }) });
  const contas = q.data ?? [];
  const proximo = (pai: ChartAccount) => {
    const filhos = contas.filter((c) => c.code.startsWith(`${pai.code}.`) && c.code.split('.').length === pai.code.split('.').length + 1).map((c) => Number(c.code.split('.').pop()));
    return `${pai.code}.${(filhos.length ? Math.max(...filhos) : 0) + 1}`;
  };
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Plano de contas"
        subtitle="As contas em que cada despesa e receita é lançada. O grupo define em que parte do DRE ela aparece. O que vem das vendas (receita, descontos, CMV, taxas) o sistema calcula sozinho."
        action={gestao ? <button className="btn-primary" onClick={() => setForm({ id: null, code: '', name: '', dreLine: 'despesa_operacional', cashOnly: false, active: true })}>Nova conta</button> : undefined}
      />
      <ErrorBox error={q.error ?? apagar.error} />
      {q.isLoading ? <Loading /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th className="w-24">Código</th><th>Conta</th><th>No DRE</th><th className="text-right">Lançamentos</th><th /></tr></thead>
            <tbody>
              {contas.map((c) => {
                const nivel = c.code.split('.').length;
                return (
                  <tr key={c.id} className={`${c.active ? '' : 'opacity-50'} ${nivel === 1 ? 'bg-cream/70 font-semibold' : c.group ? 'font-medium' : ''}`}>
                    <td className="tabular-nums">{c.code}</td>
                    <td style={{ paddingLeft: `${(nivel - 1) * 20 + 12}px` }}>
                      {c.name}
                      {c.cashOnly && <span className="badge ml-2 bg-amber-50 text-amber-700" title="Na competência o valor já entra por outro caminho (CMV das vendas ou comissão calculada). Aparece só no DRE de caixa.">só no caixa</span>}
                      {!c.active && <span className="badge ml-2 bg-slate-100 text-slate-500">inativa</span>}
                      {nivel === 1 && AUTOMATICAS[c.dreLine] && <div className="text-xs font-normal text-ink-soft">Automático pelas vendas: {AUTOMATICAS[c.dreLine]!.join(' · ')}</div>}
                    </td>
                    <td className="text-sm text-ink-soft">{nivel === 1 || c.dreLine !== contas.find((x) => x.code === c.code.split('.')[0])?.dreLine ? DRE_GROUPS[c.dreLine] : ''}</td>
                    <td className="text-right tabular-nums">{c.group ? '' : c.entries || '—'}</td>
                    <td className="whitespace-nowrap text-right text-sm">
                      {gestao && (
                        <>
                          {nivel < 3 && <button className="mr-3 text-brand" title="Nova conta dentro desta" onClick={() => setForm({ id: null, code: proximo(c), name: '', dreLine: c.dreLine, cashOnly: false, active: true })}>+ dentro</button>}
                          <button className="mr-3 text-ink-soft hover:text-ink" onClick={() => setForm({ id: c.id, code: c.code, name: c.name, dreLine: c.dreLine, cashOnly: c.cashOnly, active: c.active })}>Editar</button>
                          {!c.group && !c.entries && <button className="text-ink-soft hover:text-red-600" onClick={() => window.confirm(`Apagar a conta ${c.code} ${c.name}?`) && apagar.mutate(c.id)}>Apagar</button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-soft">Dica: a conta 2.6 guarda as guias de imposto sobre vendas. Se o DRE estiver com alíquota estimada, ela aparece só na visão de caixa (para não contar duas vezes).</p>
      {form && <Editar form={form} onClose={() => setForm(null)} onDone={() => { setForm(null); qc.invalidateQueries({ queryKey: ['chart'] }); qc.invalidateQueries({ queryKey: ['dre'] }); }} />}
    </div>
  );
}

function Editar({ form, onClose, onDone }: { form: Form; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(form);
  const salvar = useMutation({ mutationFn: () => api(f.id ? `/chart-accounts/${f.id}` : '/chart-accounts', { method: f.id ? 'PUT' : 'POST', json: { code: f.code, name: f.name, dreLine: f.dreLine, cashOnly: f.cashOnly, active: f.active } }), onSuccess: onDone });
  return (
    <Drawer title={f.id ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Código" hint="Ex.: 5.3.7 fica dentro de 5.3 (Administrativas).">
          <input className="input w-40 tabular-nums" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} placeholder="5.3.7" />
        </Field>
        <Field label="Nome"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Onde entra no DRE">
          <select className="input" value={f.dreLine} onChange={(e) => setF({ ...f, dreLine: e.target.value as DreGroup })}>
            {Object.entries(DRE_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.cashOnly} onChange={(e) => setF({ ...f, cashOnly: e.target.checked })} /> <span>Só no DRE de caixa <span className="text-ink-soft">(use para compra de mercadoria e de insumos: na competência o custo já aparece no CMV)</span></span></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativa</label>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || !f.code || f.name.trim().length < 2} onClick={() => salvar.mutate()}>Salvar</button>
      </div>
    </Drawer>
  );
}
