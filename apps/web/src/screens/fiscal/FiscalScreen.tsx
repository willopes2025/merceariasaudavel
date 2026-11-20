import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FISCAL_STATUS, addDays, todayBR, type FiscalDocument, type Page, type Store } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { FiscalTable } from '../../components/fiscal';
import { Empty, ErrorBox, Loading, PageHeader } from '../../components/ui';

/** Notas fiscais emitidas pelas lojas. */
export function FiscalScreen() {
  const client = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [from, setFrom] = useState(addDays(todayBR(), -30));
  const [to, setTo] = useState(todayBR());
  const [status, setStatus] = useState('all');
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [from, to, status, storeId]);
  const params = new URLSearchParams({ status, page: String(page), pageSize: '30' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (storeId) params.set('storeId', storeId);
  const list = useQuery({ queryKey: ['fiscal-documents', params.toString()], queryFn: () => api<Page<FiscalDocument>>(`/fiscal/documents?${params}`) });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Notas fiscais"
        subtitle="NFC-e das vendas do caixa. A nota sai sozinha ao finalizar a venda (se ligado) ou pela tela da venda."
        action={
          can('settings.manage') && (
            <Link className="btn-ghost" to="/configuracoes/fiscal">
              Configuração fiscal
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
        <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="all">Todas</option>
          {Object.entries(FISCAL_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
          <option value="">Todas as lojas</option>
          {stores.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={list.error} />
      <div className="card overflow-x-auto">
        {list.isLoading ? <Loading /> : !list.data?.items.length ? <Empty>Nenhuma nota nesse período.</Empty> : <FiscalTable rows={list.data.items} showSale onChanged={() => client.invalidateQueries({ queryKey: ['fiscal-documents'] })} />}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span>
            {page} de {pages}
          </span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
