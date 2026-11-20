import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  GENDERS,
  formatCep,
  formatCpf,
  formatCnpj,
  formatMoney,
  formatPhone,
  type Customer,
  type Page,
  type Prescription,
  type PrescriptionSummary,
  type QuoteRow,
  type Receivable,
  type ServiceOrderRow,
  type TimelineItem,
} from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Loading } from '../../components/ui';
import { ReceivablesTable } from '../../components/receivables';
import { QuoteStatusBadge } from '../quotes/QuotesScreen';
import { AlertBadges, PrescriptionForm, PrescriptionGrid, SituationBadge, formatDateTime, formatDay } from '../../components/os';
import { age } from './CustomersScreen';

type Tab = 'dados' | 'receitas' | 'orcamentos' | 'os' | 'compras' | 'parcelas' | 'conversas' | 'historico';

/** O que cada aba vai mostrar e em que fase entra. */
const UPCOMING: Partial<Record<Tab, { phase: number; text: string }>> = {
  compras: { phase: 3, text: 'Vendas, produtos comprados, ticket e cashback.' },
  conversas: { phase: 6, text: 'As conversas de WhatsApp, Instagram e Messenger, ao lado da ficha.' },
};

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'dados', label: 'Dados' },
  { key: 'receitas', label: 'Receitas' },
  { key: 'orcamentos', label: 'Orçamentos' },
  { key: 'os', label: 'O.S.' },
  { key: 'compras', label: 'Compras' },
  { key: 'parcelas', label: 'Parcelas' },
  { key: 'conversas', label: 'Conversas' },
  { key: 'historico', label: 'Histórico' },
];

/** Ficha 360° do cliente: tudo sobre ele numa tela. */
export function CustomerScreen() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('dados');
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api<Customer>(`/customers/${id}`) });

  if (customer.isLoading) return <Loading />;
  if (!customer.data) return <Empty>Cliente não encontrado.</Empty>;
  const c = customer.data;
  const years = age(c.birthDate);
  const whatsapp = c.phone && c.allowWhatsapp ? `https://wa.me/${c.phone}` : null;

  return (
    <div className="max-w-5xl">
      <Link to="/clientes" className="text-sm text-ink-soft hover:text-ink">
        ← Clientes
      </Link>

      <div className="card mt-3 flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <h1 className="text-xl font-semibold">
            {c.name}
            {!c.active && <span className="badge ml-2 bg-slate-100 align-middle text-slate-500">Inativo</span>}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {[c.document && (c.kind === 'pf' ? formatCpf(c.document) : formatCnpj(c.document)), years !== null && `${years} anos`, c.city && `${c.city}${c.state ? `/${c.state}` : ''}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.operationName && <span className="badge bg-brand-soft text-brand">{c.operationName}</span>}
            {c.originName && <span className="badge bg-slate-100 text-ink-soft">Origem: {c.originName}</span>}
            {c.insurancePlanName && <span className="badge bg-slate-100 text-ink-soft">Convênio: {c.insurancePlanName}</span>}
            {c.externalCode && <span className="badge bg-slate-100 text-ink-soft">ssÓtica #{c.externalCode}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {whatsapp && (
            <a className="btn-ghost" href={whatsapp} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
          {can('customer.manage') && (
            <Link className="btn-primary" to={`/clientes/${c.id}/editar`}>
              Editar
            </Link>
          )}
        </div>
      </div>

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Seções da ficha">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-brand font-medium text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'dados' && <Details c={c} />}
        {tab === 'receitas' && <PrescriptionsTab customer={c} />}
        {tab === 'orcamentos' && <QuotesTab customer={c} />}
        {tab === 'os' && <OrdersTab customer={c} />}
        {tab === 'parcelas' && <InstallmentsTab customer={c} />}
        {tab === 'historico' && <Timeline id={c.id} />}
        {UPCOMING[tab] && (
          <div className="card p-6">
            <span className="badge bg-brand-soft text-brand">Entra na Fase {UPCOMING[tab]!.phase}</span>
            <p className="mt-3 text-sm">{UPCOMING[tab]!.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Details({ c }: { c: Customer }) {
  const address = [c.street && `${c.street}${c.number ? `, ${c.number}` : ''}`, c.complement, c.district, c.city && `${c.city}${c.state ? `/${c.state}` : ''}`, c.zip && formatCep(c.zip)]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Block title="Contato">
        <Item label="WhatsApp" value={c.phone && `${formatPhone(c.phone)}${c.allowWhatsapp ? '' : ' (não aceita mensagens)'}`} />
        <Item label="Outro telefone" value={c.phone2 && formatPhone(c.phone2)} />
        <Item label="E-mail" value={c.email && `${c.email}${c.allowEmail ? '' : ' (não aceita e-mail)'}`} />
        <Item label="Endereço" value={address} />
      </Block>
      <Block title="Pessoal">
        <Item label="Apelido" value={c.nickname} />
        <Item label="Nascimento" value={c.birthDate && new Date(`${c.birthDate}T00:00:00`).toLocaleDateString('pt-BR')} />
        <Item label="Sexo" value={c.gender && GENDERS[c.gender]} />
        <Item label="RG" value={c.rg} />
        <Item label="Profissão" value={c.profession} />
        <Item label="Mãe" value={c.motherName} />
        <Item label="Pai" value={c.fatherName} />
        <Item label="Responsável" value={c.guardianName} />
      </Block>
      <Block title="Relacionamento">
        <Item label="Loja" value={c.storeName} />
        <Item label="Vendedor(a) de preferência" value={c.preferredSellerName} />
        <Item label="Cliente desde" value={new Date(c.createdAt).toLocaleDateString('pt-BR')} />
      </Block>
      {c.notes && (
        <Block title="Observações">
          <p className="whitespace-pre-line text-sm">{c.notes}</p>
        </Block>
      )}
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const items = useQuery({ queryKey: ['customer-timeline', id], queryFn: () => api<TimelineItem[]>(`/customers/${id}/timeline`) });
  if (items.isLoading) return <Loading />;
  if (!items.data?.length) return <Empty>Sem registros ainda.</Empty>;
  return (
    <ol className="card divide-y divide-slate-100">
      {items.data.map((t, i) => (
        <li key={i} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
          <span>{t.label}</span>
          <span className="text-ink-soft">
            {new Date(t.at).toLocaleString('pt-BR')}
            {t.userName && ` · ${t.userName}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined | false }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="col-span-2">{value}</dd>
    </div>
  );
}

/** Receitas do cliente. Os graus só para quem tem acesso clínico (a leitura fica registrada). */
function PrescriptionsTab({ customer }: { customer: Customer }) {
  const client = useQueryClient();
  const clinical = can('prescription.view');
  const [editing, setEditing] = useState<Prescription | 'new' | null>(null);
  const full = useQuery({
    queryKey: ['prescriptions', customer.id],
    queryFn: () => api<Prescription[]>(`/customers/${customer.id}/prescriptions`),
    enabled: clinical,
  });
  const summaries = useQuery({
    queryKey: ['prescription-summaries', customer.id],
    queryFn: () => api<PrescriptionSummary[]>(`/customers/${customer.id}/prescription-summaries`),
    enabled: !clinical && can('service_order.view'),
  });
  const list: Array<Prescription | PrescriptionSummary> = (clinical ? full.data : summaries.data) ?? [];
  const loading = clinical ? full.isLoading : summaries.isLoading;

  return (
    <div className="space-y-3">
      {can('prescription.manage') && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setEditing('new')}>
            Lançar receita
          </button>
        </div>
      )}
      <ErrorBox error={full.error ?? summaries.error} />
      {loading ? (
        <Loading />
      ) : !list.length ? (
        <div className="card p-6 text-sm text-ink-soft">Nenhuma receita lançada.</div>
      ) : (
        list.map((p) => (
          <div key={p.id} className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-medium">Exame de {formatDay(p.examDate)}</span>
                {p.doctorName && <span className="text-ink-soft"> · {p.doctorName}</span>}
                <span className={`badge ml-2 ${p.expired ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {p.expired ? 'Vencida' : `Vale até ${formatDay(p.validUntil)}`}
                </span>
              </div>
              {'od' in p && can('prescription.manage') && (
                <button className="text-sm text-brand" onClick={() => setEditing(p)}>
                  Editar
                </button>
              )}
            </div>
            {'od' in p ? (
              <>
                <PrescriptionGrid p={p} />
                {(p.baseCurve || p.notes) && (
                  <p className="mt-2 text-sm text-ink-soft">{[p.baseCurve && `Curva base ${p.baseCurve}`, p.notes].filter(Boolean).join(' · ')}</p>
                )}
                {p.createdByName && <p className="mt-1 text-xs text-ink-soft">Lançada por {p.createdByName}</p>}
              </>
            ) : (
              <p className="text-sm text-ink-soft">Os graus aparecem só para quem tem acesso a receitas.</p>
            )}
          </div>
        ))
      )}
      {editing && (
        <Drawer title={editing === 'new' ? 'Nova receita' : 'Editar receita'} onClose={() => setEditing(null)} wide>
          <PrescriptionForm
            customerId={customer.id}
            initial={editing === 'new' ? undefined : editing}
            onSaved={() => {
              client.invalidateQueries({ queryKey: ['prescriptions', customer.id] });
              client.invalidateQueries({ queryKey: ['prescription-summaries', customer.id] });
              client.invalidateQueries({ queryKey: ['customer-timeline', customer.id] });
              setEditing(null);
            }}
          />
        </Drawer>
      )}
    </div>
  );
}

function OrdersTab({ customer }: { customer: Customer }) {
  const orders = useQuery({
    queryKey: ['service-orders', 'customer', customer.id],
    queryFn: () => api<Page<ServiceOrderRow>>(`/service-orders?customerId=${customer.id}&situation=todas&pageSize=100`),
    enabled: can('service_order.view'),
  });
  if (!can('service_order.view')) return <div className="card p-6 text-sm text-ink-soft">Você não tem acesso às O.S.</div>;
  return (
    <div className="space-y-3">
      {can('service_order.manage') && (
        <div className="flex justify-end">
          <Link className="btn-primary" to={`/os/nova?cliente=${customer.id}`}>
            Nova O.S.
          </Link>
        </div>
      )}
      <div className="card overflow-x-auto">
        {orders.isLoading ? (
          <Loading />
        ) : !orders.data?.items.length ? (
          <Empty>Nenhuma O.S. deste cliente.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Aberta em</th>
                <th>Etapa</th>
                <th>Situação</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium tabular-nums">
                    <Link to={`/os/${o.id}`} className="text-brand">
                      {o.number}
                    </Link>
                  </td>
                  <td className="tabular-nums">{formatDateTime(o.createdAt)}</td>
                  <td>
                    {o.stageName}
                    <div className="flex gap-1">
                      <AlertBadges order={o} />
                    </div>
                  </td>
                  <td>
                    <SituationBadge situation={o.situation} />
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function QuotesTab({ customer }: { customer: Customer }) {
  const quotes = useQuery({
    queryKey: ['quotes', 'customer', customer.id],
    queryFn: () => api<Page<QuoteRow>>(`/quotes?customerId=${customer.id}&status=todos&pageSize=100`),
    enabled: can('quote.manage'),
  });
  if (!can('quote.manage')) return <div className="card p-6 text-sm text-ink-soft">Você não tem acesso aos orçamentos.</div>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link className="btn-primary" to={`/orcamentos/novo?cliente=${customer.id}`}>
          Novo orçamento
        </Link>
      </div>
      <div className="card overflow-x-auto">
        {quotes.isLoading ? (
          <Loading />
        ) : !quotes.data?.items.length ? (
          <Empty>Nenhum orçamento deste cliente.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Feito em</th>
                <th>Situação</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {quotes.data.items.map((q) => (
                <tr key={q.id}>
                  <td className="font-medium tabular-nums">
                    <Link to={`/orcamentos/${q.id}`} className="text-brand">
                      {q.number}
                    </Link>
                  </td>
                  <td className="tabular-nums">{formatDateTime(q.createdAt)}</td>
                  <td>
                    <QuoteStatusBadge q={q} />
                    {q.serviceOrderNumber && <span className="ml-2 text-xs text-ink-soft">O.S. {q.serviceOrderNumber}</span>}
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(q.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function InstallmentsTab({ customer }: { customer: Customer }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['receivables', 'customer', customer.id],
    queryFn: () => api<Page<Receivable>>(`/receivables?customerId=${customer.id}&status=all&pageSize=100`),
    enabled: can('finance.view'),
  });
  if (!can('finance.view')) return <div className="card p-6 text-sm text-ink-soft">As parcelas aparecem dentro de cada O.S. do cliente.</div>;
  return (
    <div className="card overflow-x-auto">
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.items.length ? (
        <Empty>Este cliente não tem crediário.</Empty>
      ) : (
        <ReceivablesTable rows={list.data.items} showCustomer onChanged={() => client.invalidateQueries({ queryKey: ['receivables'] })} />
      )}
    </div>
  );
}
