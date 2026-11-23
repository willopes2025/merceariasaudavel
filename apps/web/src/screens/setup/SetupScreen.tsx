import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SETUP_STATUS, type SetupItemRow, type SetupReport, type SetupStatus } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { ErrorBox, Loading, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../components/format';

const COR: Record<SetupStatus, string> = { pendente: 'bg-amber-100 text-amber-800', recebido: 'bg-sky-100 text-sky-800', concluido: 'bg-emerald-100 text-emerald-800', nao_se_aplica: 'bg-slate-100 text-slate-600' };
const feito = (s: SetupStatus) => s === 'concluido' || s === 'nao_se_aplica';

/** Implantação: o que a loja ainda precisa enviar ou configurar, concluído um a um. */
export function SetupScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['implantacao'], queryFn: () => api<SetupReport>('/setup') });
  const [filtro, setFiltro] = useState<'abertos' | 'todos'>('abertos');
  const salvar = useMutation({
    mutationFn: (p: { key: string; status: SetupStatus; note: string | null }) => api(`/setup/${p.key}`, { method: 'PUT', json: { status: p.status, note: p.note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['implantacao'] }),
  });
  const d = q.data;
  const pct = d && d.total ? Math.round((d.done / d.total) * 100) : 0;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Implantação" subtitle="Tudo que falta a loja enviar ou configurar para o sistema operar com os dados reais. Marque cada item conforme for recebendo e concluindo." />
      <ErrorBox error={q.error ?? salvar.error} />
      {q.isLoading ? <Loading /> : d && (
        <>
          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-ink"><b className="text-lg">{d.done}</b> de {d.total} concluídos · {d.received} recebidos aguardando configuração · <b>{d.total - d.done - d.received}</b> pendentes</div>
              <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
                {(['abertos', 'todos'] as const).map((f) => <button key={f} className={`px-3 py-1.5 ${filtro === f ? 'bg-brand text-white' : 'bg-white text-ink'}`} onClick={() => setFiltro(f)}>{f === 'abertos' ? 'Só o que falta' : 'Todos'}</button>)}
              </div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-3 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="text-xs text-ink-soft">{pct}% da implantação concluída</div>
          </div>
          {d.groups.map((g) => {
            const itens = g.items.filter((i) => filtro === 'todos' || !feito(i.status));
            const prontos = g.items.filter((i) => feito(i.status)).length;
            if (!itens.length) return filtro === 'todos' ? null : <div key={g.group} className="card flex items-center justify-between p-4 text-sm"><span className="font-display text-lg text-ink">{g.group}</span><span className="text-emerald-700">Tudo concluído ✓</span></div>;
            return (
              <section key={g.group} className="card">
                <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <h2 className="font-display text-lg text-ink">{g.group}</h2>
                  <span className="text-sm text-ink-soft">{prontos} de {g.items.length}</span>
                </div>
                {g.hint && <p className="px-4 pt-3 text-sm text-ink-soft">{g.hint}</p>}
                <ul className="divide-y divide-slate-100">
                  {itens.map((i) => <Item key={i.key} item={i} salvando={salvar.isPending} onSave={(status, note) => salvar.mutate({ key: i.key, status, note })} />)}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Item({ item, salvando, onSave }: { item: SetupItemRow; salvando: boolean; onSave: (s: SetupStatus, note: string | null) => void }) {
  const [nota, setNota] = useState(item.note ?? '');
  const [aberto, setAberto] = useState(false);
  const mudou = nota.trim() !== (item.note ?? '');
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <div className={`text-sm ${feito(item.status) ? 'text-ink-soft line-through' : 'text-ink'}`}>{item.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
            {item.detected && <span className="text-emerald-700">No sistema: {item.detected}</span>}
            {item.path && <Link to={item.path} className="text-brand hover:underline">Abrir a tela →</Link>}
            {item.updatedAt && <span className="text-ink-soft">{item.updatedBy ?? 'Alguém'} · {formatDateTime(item.updatedAt)}</span>}
          </div>
          {item.note && !aberto && <div className="mt-1 text-xs text-ink-soft">Obs.: {item.note}</div>}
        </div>
        <div className="flex items-center gap-2">
          <select className={`rounded-full border-0 px-3 py-1 text-xs font-medium ${COR[item.status]}`} value={item.status} disabled={salvando} onChange={(e) => onSave(e.target.value as SetupStatus, item.note)} aria-label="Situação">
            {Object.entries(SETUP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="text-xs text-ink-soft hover:text-ink" onClick={() => setAberto(!aberto)}>{aberto ? 'Fechar' : 'Observação'}</button>
        </div>
      </div>
      {aberto && (
        <div className="flex gap-2">
          <input className="input flex-1 text-sm" value={nota} maxLength={500} placeholder="Ex.: contador ficou de enviar até sexta" onChange={(e) => setNota(e.target.value)} />
          <button className="btn-primary" disabled={!mudou || salvando} onClick={() => { onSave(item.status, nota.trim() || null); setAberto(false); }}>Salvar</button>
        </div>
      )}
    </li>
  );
}
