import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, todayBR, type AuditPage } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../components/format';

const resumo = (d: unknown) => {
  if (d == null) return '';
  if (typeof d !== 'object') return String(d);
  return Object.entries(d as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`).join(' · ');
};

/** Histórico de alterações: quem fez o quê e quando. O registro só cresce; ninguém apaga nem edita. */
export function AuditScreen() {
  const hoje = todayBR();
  const [de, setDe] = useState(addDays(hoje, -7));
  const [ate, setAte] = useState(hoje);
  const [usuario, setUsuario] = useState('');
  const [entidade, setEntidade] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ from: de, to: ate, page: String(pagina), ...(usuario ? { userId: usuario } : {}), ...(entidade ? { entity: entidade } : {}), ...(busca.trim().length >= 2 ? { q: busca.trim() } : {}) });
  const q = useQuery({ queryKey: ['auditoria', params.toString()], queryFn: () => api<AuditPage>(`/audit?${params}`), placeholderData: (a) => a });
  const mudar = <T,>(f: (v: T) => void) => (v: T) => { f(v); setPagina(1); };
  const paginas = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Auditoria" subtitle="Tudo que foi alterado no sistema: quem, quando e o quê. O registro não pode ser apagado nem editado." />
      <ErrorBox error={q.error} />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="De"><input type="date" className="input w-40" value={de} onChange={(e) => e.target.value && mudar(setDe)(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="input w-40" value={ate} onChange={(e) => e.target.value && mudar(setAte)(e.target.value)} /></Field>
        <Field label="Quem"><select className="input w-48" value={usuario} onChange={(e) => mudar(setUsuario)(e.target.value)}><option value="">Todo mundo</option>{q.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Onde"><select className="input w-48" value={entidade} onChange={(e) => mudar(setEntidade)(e.target.value)}><option value="">Tudo</option>{q.data?.entities.map((e) => <option key={e} value={e}>{e}</option>)}</select></Field>
        <Field label="Buscar ação"><input className="input w-48" value={busca} onChange={(e) => mudar(setBusca)(e.target.value)} placeholder="ex.: cancel, delete" /></Field>
      </div>
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : !q.data?.rows.length ? <Empty>Nada registrado com esse filtro.</Empty> : (
          <table className="table">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Onde</th><th>Detalhes</th></tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap tabular-nums">{formatDateTime(r.at)}</td>
                  <td className="whitespace-nowrap">{r.userName ?? 'Sistema'}</td>
                  <td className="whitespace-nowrap font-medium">{r.action}</td>
                  <td className="whitespace-nowrap text-ink-soft">{r.entity}</td>
                  <td className="max-w-md break-words text-sm text-ink-soft">{resumo(r.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.data && q.data.total > q.data.pageSize && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <button className="btn-ghost" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span>Página {pagina} de {paginas} · {q.data.total} registros</span>
          <button className="btn-ghost" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Próxima</button>
        </div>
      )}
    </div>
  );
}
