import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BROADCAST_SEGMENTS, formatMoney, todayBR, type AdsReport, type Broadcast, type BroadcastPreview, type BroadcastSegmentKind, type Category } from '@mercearia/contracts';
import { api, fetchFeatures } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../components/format';

const COR: Record<Broadcast['status'], string> = { rascunho: 'bg-slate-100 text-slate-600', enviando: 'bg-amber-100 text-amber-800', concluido: 'bg-emerald-100 text-emerald-800', cancelado: 'bg-red-100 text-red-700' };
const COM_DIAS: BroadcastSegmentKind[] = ['sumidos', 'recentes'];

/** Disparos de WhatsApp para grupos de clientes e o resultado dos anúncios (de onde vieram cadastros e pedidos). */
export function BroadcastScreen() {
  const [aba, setAba] = useState<'disparos' | 'anuncios'>('disparos');
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Disparos e anúncios" subtitle="Mande uma mensagem de WhatsApp para um grupo de clientes e veja quanto voltou em venda. Na outra aba, de qual anúncio vieram os cadastros e pedidos do app." />
      <div className="flex gap-2">
        {(['disparos', 'anuncios'] as const).map((a) => <button key={a} className={`rounded-full px-4 py-1.5 text-sm ${aba === a ? 'bg-brand text-white' : 'bg-white text-ink ring-1 ring-slate-300'}`} onClick={() => setAba(a)}>{a === 'disparos' ? 'Disparos' : 'Anúncios (origem)'}</button>)}
      </div>
      {aba === 'disparos' ? <Disparos /> : <Anuncios />}
    </div>
  );
}

function Disparos() {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [ver, setVer] = useState<Broadcast | null>(null);
  const recursos = useQuery({ queryKey: ['features'], queryFn: fetchFeatures });
  const q = useQuery({ queryKey: ['disparos'], queryFn: () => api<Broadcast[]>('/broadcasts'), refetchInterval: (r) => (r.state.data?.some((b) => b.status === 'enviando') ? 4000 : false) });
  const cancelar = useMutation({ mutationFn: (id: string) => api(`/broadcasts/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['disparos'] }) });
  return (
    <>
      <ErrorBox error={q.error ?? cancelar.error} />
      {recursos.data && !recursos.data.whatsapp && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">O WhatsApp ainda não está conectado neste servidor. Dá para montar o grupo e ver quantas pessoas entram, mas o envio só funciona depois de configurar as chaves (Z-API ou API oficial) no servidor.</div>}
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setNovo(true)}>Novo disparo</button></div>
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Nenhum disparo ainda.</Empty> : (
          <table className="table">
            <thead><tr><th>Disparo</th><th>Grupo</th><th>Situação</th><th className="text-right">Enviadas</th><th className="text-right">Falhas</th><th className="text-right">Vendas em 7 dias</th><th /></tr></thead>
            <tbody>
              {q.data.map((b) => (
                <tr key={b.id}>
                  <td><button className="text-left font-medium text-brand hover:underline" onClick={() => setVer(b)}>{b.name}</button><div className="text-xs text-ink-soft">{formatDateTime(b.createdAt)}</div></td>
                  <td className="text-sm">{BROADCAST_SEGMENTS[b.segment.kind]}{COM_DIAS.includes(b.segment.kind) ? ` (${b.segment.days} dias)` : ''}</td>
                  <td><span className={`rounded-full px-2 py-0.5 text-xs ${COR[b.status]}`}>{b.status === 'concluido' ? 'concluído' : b.status}</span></td>
                  <td className="text-right tabular-nums">{b.sent} / {b.total}</td>
                  <td className="text-right tabular-nums">{b.failed || '—'}</td>
                  <td className="text-right tabular-nums">{b.salesAfter ? `${b.salesAfter} · ${formatMoney(b.revenueAfter)}` : '—'}</td>
                  <td className="text-right">{b.status === 'enviando' && <button className="text-sm text-red-600 hover:underline" onClick={() => window.confirm('Parar este disparo? Quem já recebeu continua com a mensagem.') && cancelar.mutate(b.id)}>Parar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-sm text-ink-soft">Só recebe quem tem celular e não pediu para não receber mensagens. O envio é devagar de propósito (uma mensagem a cada poucos segundos) para o número não ser bloqueado. Pela API oficial da Meta, texto livre só chega para quem falou com a loja nas últimas 24 horas.</p>
      {novo && <Novo onClose={() => setNovo(false)} onDone={() => { setNovo(false); qc.invalidateQueries({ queryKey: ['disparos'] }); }} />}
      {ver && <Detalhe disparo={ver} onClose={() => setVer(null)} />}
    </>
  );
}

function Novo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [nome, setNome] = useState('');
  const [msg, setMsg] = useState('Oi, {nome}! ');
  const [grupo, setGrupo] = useState<BroadcastSegmentKind>('membros');
  const [dias, setDias] = useState('60');
  const [categoria, setCategoria] = useState('');
  const categorias = useQuery({ queryKey: ['categorias'], queryFn: () => api<Category[]>('/categories') });
  const segment = { kind: grupo, days: Number(dias) || 60, categoryId: categoria || null };
  const previa = useQuery({ queryKey: ['disparo-previa', grupo, dias, categoria], queryFn: () => api<BroadcastPreview>('/broadcasts/preview', { method: 'POST', json: segment }) });
  const enviar = useMutation({ mutationFn: () => api('/broadcasts', { method: 'POST', json: { name: nome, message: msg, segment } }), onSuccess: onDone });
  const exemplo = msg.replace(/\{nome\}/gi, (previa.data?.sample[0]?.name ?? 'Maria').split(' ')[0]!).replace(/\{cashback\}/gi, 'R$ 12,50');
  return (
    <Drawer title="Novo disparo" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Nome do disparo (só para você)"><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Black Friday membros" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Para quem"><select className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as BroadcastSegmentKind)}>{Object.entries(BROADCAST_SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {COM_DIAS.includes(grupo) && <Field label="Dias"><input className="input w-28" type="number" min={1} max={730} value={dias} onChange={(e) => setDias(e.target.value)} /></Field>}
          <Field label="Só quem já comprou da categoria"><select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Qualquer categoria</option>{categorias.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        <div className="rounded-lg bg-cream/60 p-3 text-sm">
          {previa.isLoading ? 'Contando…' : previa.data ? <><b>{previa.data.count > 2000 ? 'Mais de 2.000' : previa.data.count}</b> pessoas vão receber{previa.data.sample.length ? `: ${previa.data.sample.map((s) => s.name.split(' ')[0]).join(', ')}${previa.data.count > previa.data.sample.length ? '…' : ''}` : '.'}</> : null}
        </div>
        <Field label="Mensagem" hint="Use {nome} para o primeiro nome e {cashback} para o saldo de cashback."><textarea className="input h-36" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1500} /></Field>
        <div className="rounded-lg bg-emerald-50 p-3 text-sm whitespace-pre-wrap"><div className="mb-1 text-xs text-ink-soft">Como chega:</div>{exemplo}</div>
        <ErrorBox error={previa.error ?? enviar.error} />
        <button className="btn-primary w-full" disabled={enviar.isPending || !previa.data?.count} onClick={() => window.confirm(`Enviar agora para ${previa.data!.count} pessoas?`) && enviar.mutate()}>Enviar agora</button>
      </div>
    </Drawer>
  );
}

function Detalhe({ disparo, onClose }: { disparo: Broadcast; onClose: () => void }) {
  const q = useQuery({ queryKey: ['disparo', disparo.id], queryFn: () => api<Array<{ id: string; name: string; phone: string; status: string; error: string | null; sentAt: string | null }>>(`/broadcasts/${disparo.id}/recipients`) });
  return (
    <Drawer title={disparo.name} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="rounded-lg bg-cream/60 p-3 text-sm whitespace-pre-wrap">{disparo.message}</div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : (
          <table className="table text-sm">
            <thead><tr><th>Cliente</th><th>Celular</th><th>Situação</th></tr></thead>
            <tbody>{q.data?.map((r) => <tr key={r.id}><td>{r.name}</td><td className="tabular-nums">{r.phone}</td><td className={r.status === 'falhou' ? 'text-red-700' : r.status === 'enviado' ? 'text-emerald-700' : 'text-ink-soft'}>{r.status}{r.error ? ` · ${r.error}` : ''}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}

function Anuncios() {
  const hoje = todayBR();
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje);
  const q = useQuery({ queryKey: ['anuncios', de, ate], queryFn: () => api<AdsReport>(`/broadcasts/ads?from=${de}&to=${ate}`), enabled: de <= ate });
  return (
    <>
      <ErrorBox error={q.error} />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="De"><input type="date" className="input w-40" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="input w-40" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>
      </div>
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : !q.data?.rows.length ? <Empty>Nenhum cadastro ou pedido com origem marcada no período.</Empty> : (
          <table className="table">
            <thead><tr><th>Origem</th><th>Campanha</th><th className="text-right">Cadastros</th><th className="text-right">Pedidos</th><th className="text-right">Vendido</th></tr></thead>
            <tbody>{q.data.rows.map((r, i) => <tr key={i}><td className="font-medium">{r.source}</td><td>{r.campaign || '—'}</td><td className="text-right tabular-nums">{r.signups}</td><td className="text-right tabular-nums">{r.orders}</td><td className="text-right tabular-nums">{formatMoney(r.revenue)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <p className="text-sm text-ink-soft">Para o sistema saber de onde a pessoa veio, o link do anúncio precisa levar os marcadores, por exemplo: <code className="rounded bg-slate-100 px-1">…/loja?utm_source=instagram&amp;utm_campaign=black-friday</code>. O Meta Ads e o Google Ads colocam isso sozinhos se você preencher os "parâmetros de URL" do anúncio.</p>
    </>
  );
}
