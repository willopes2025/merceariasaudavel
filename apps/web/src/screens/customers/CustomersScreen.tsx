import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCpf, formatPhone, type CustomerRow, type LookupRow, type Operation, type Page } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Empty, Loading, PageHeader } from '../../components/ui';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function age(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00:00`);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a;
}

/** Lista de clientes: busca por nome, CPF ou telefone, com filtros que ficam na URL. */
export function CustomersScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q);

  const filters = {
    q: debounced,
    status: params.get('status') ?? 'active',
    originId: params.get('originId') ?? '',
    operationId: params.get('operationId') ?? '',
    birthMonth: params.get('birthMonth') ?? '',
    page: Number(params.get('page') ?? 1),
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => set('q', debounced), [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)]));
  const list = useQuery({
    queryKey: ['customers', query.toString()],
    queryFn: () => api<Page<CustomerRow>>(`/customers?${query}`),
    placeholderData: keepPreviousData,
  });
  const origins = useQuery({ queryKey: ['/customer-origins'], queryFn: () => api<LookupRow[]>('/customer-origins') });
  const operations = useQuery({ queryKey: ['operations'], queryFn: () => api<Operation[]>('/operations') });

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Clientes"
        subtitle={list.data ? `${list.data.total.toLocaleString('pt-BR')} cliente(s)` : undefined}
        action={can('customer.manage') && <Link className="btn-primary" to="/clientes/novo">Novo cliente</Link>}
      />

      <div className="card mb-4 grid gap-3 p-4 md:grid-cols-6">
        <input
          className="input md:col-span-2"
          placeholder="Buscar por nome, CPF ou telefone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          aria-label="Buscar cliente"
        />
        <select className="input" value={filters.originId} onChange={(e) => set('originId', e.target.value)} aria-label="Origem">
          <option value="">Todas as origens</option>
          {origins.data?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select className="input" value={filters.operationId} onChange={(e) => set('operationId', e.target.value)} aria-label="Operação">
          <option value="">Todas as operações</option>
          {operations.data?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select className="input" value={filters.birthMonth} onChange={(e) => set('birthMonth', e.target.value)} aria-label="Aniversariantes">
          <option value="">Aniversariantes: todos</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              Aniversário em {m}
            </option>
          ))}
        </select>
        <select className="input" value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Situação">
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="all">Todos</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>{filters.q ? 'Ninguém encontrado com essa busca.' : 'Nenhum cliente ainda.'}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF/CNPJ</th>
                <th>WhatsApp</th>
                <th>Cidade</th>
                <th>Idade</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody className={list.isFetching ? 'opacity-60' : ''}>
              {list.data.items.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <td>
                    <span className="font-medium">{c.name}</span>
                    {!c.active && <span className="badge ml-2 bg-slate-100 text-slate-500">Inativo</span>}
                  </td>
                  <td className="whitespace-nowrap">{c.document ? formatCpf(c.document) : '—'}</td>
                  <td className="whitespace-nowrap">{c.phone ? formatPhone(c.phone) : '—'}</td>
                  <td>{c.city ?? '—'}</td>
                  <td>{age(c.birthDate) ?? '—'}</td>
                  <td className="text-ink-soft">{c.originName ?? c.operationName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-3 text-sm">
          <button className="btn-ghost" disabled={filters.page <= 1} onClick={() => set('page', String(filters.page - 1))}>
            Anterior
          </button>
          <span className="text-ink-soft">
            Página {filters.page} de {pages}
          </span>
          <button className="btn-ghost" disabled={filters.page >= pages} onClick={() => set('page', String(filters.page + 1))}>
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
