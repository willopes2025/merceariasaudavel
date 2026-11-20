import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FISCAL_STATUS, fiscalCancelSchema, formatMoney, type FiscalDocument, type FiscalPreview } from '@mercearia/contracts';
import { api, can } from '../lib/api';
import { Drawer, ErrorBox, Field } from './ui';
import { formatDateTime } from './format';

const COLORS: Record<FiscalDocument['status'], string> = {
  processing: 'bg-amber-50 text-amber-700',
  authorized: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-600',
  canceled: 'bg-slate-100 text-slate-500',
  error: 'bg-red-50 text-red-600',
};

export function FiscalBadge({ doc }: { doc: FiscalDocument }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`badge ${COLORS[doc.status]}`}>{FISCAL_STATUS[doc.status]}</span>
      {doc.environment === 'homologacao' && <span className="badge bg-sky-50 text-sky-700">Teste</span>}
    </span>
  );
}

/** Notas com as ações: abrir o cupom, atualizar e cancelar. */
export function FiscalTable({ rows, showSale, onChanged }: { rows: FiscalDocument[]; showSale?: boolean; onChanged: () => void }) {
  const [canceling, setCanceling] = useState<FiscalDocument | null>(null);
  const refresh = useMutation({ mutationFn: (id: string) => api(`/fiscal/documents/${id}/refresh`, { method: 'POST' }), onSettled: onChanged });
  return (
    <>
      <ErrorBox error={refresh.error} />
      <table className="table">
        <thead>
          <tr>
            <th>Nota</th>
            {showSale && <th>Venda</th>}
            <th>Situação</th>
            <th className="text-right">Valor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                <span className="font-medium">NFC-e {d.number ? `nº ${d.number}` : ''}</span>
                <div className="text-xs text-ink-soft">
                  {formatDateTime(d.createdAt)}
                  {d.userName && ` · ${d.userName}`}
                </div>
              </td>
              {showSale && (
                <td>
                  <Link to={`/vendas/${d.saleId}`} className="font-medium text-brand">
                    Venda {d.saleNumber ?? ''}
                  </Link>
                  <div className="text-xs text-ink-soft">{[d.customerName, d.storeName].filter(Boolean).join(' · ')}</div>
                </td>
              )}
              <td>
                <FiscalBadge doc={d} />
                {d.status !== 'authorized' && d.message && <div className="mt-1 max-w-xs text-xs text-ink-soft">{d.status === 'canceled' && d.cancelReason ? `Motivo: ${d.cancelReason}` : d.message}</div>}
              </td>
              <td className="text-right tabular-nums">{formatMoney(d.total)}</td>
              <td className="whitespace-nowrap text-right text-sm">
                {d.danfeUrl && d.status !== 'rejected' && (
                  <a className="text-brand" href={d.danfeUrl} target="_blank" rel="noreferrer">
                    Abrir cupom
                  </a>
                )}
                {d.status === 'processing' && can('fiscal.emit') && (
                  <button className="ml-3 text-brand" disabled={refresh.isPending} onClick={() => refresh.mutate(d.id)}>
                    Atualizar
                  </button>
                )}
                {d.status === 'authorized' && can('fiscal.cancel') && (
                  <button className="ml-3 text-ink-soft hover:text-red-600" onClick={() => setCanceling(d)}>
                    Cancelar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canceling && (
        <CancelDrawer
          doc={canceling}
          onClose={() => setCanceling(null)}
          onDone={() => {
            setCanceling(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function CancelDrawer({ doc, onClose, onDone }: { doc: FiscalDocument; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const cancel = useMutation({ mutationFn: (body: unknown) => api(`/fiscal/documents/${doc.id}/cancel`, { method: 'POST', json: body }), onSuccess: onDone, onError: setError });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = fiscalCancelSchema.safeParse({ reason });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    setError(null);
    cancel.mutate(parsed.data);
  }
  return (
    <Drawer title={`Cancelar NFC-e ${doc.number ? `nº ${doc.number}` : ''}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-soft">A NFC-e só pode ser cancelada em até 30 minutos depois de emitida. O cancelamento não tem volta.</p>
        <Field label="Motivo" hint="Vai para a SEFAZ. Pelo menos 15 letras.">
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={cancel.isPending}>
          {cancel.isPending ? 'Cancelando…' : 'Cancelar a nota'}
        </button>
      </form>
    </Drawer>
  );
}

/** Bloco "Nota fiscal" da venda: mostra as notas e emite a NFC-e. */
export function SaleFiscal({ saleId }: { saleId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ['sale-fiscal', saleId], queryFn: () => api<FiscalPreview>(`/sales/${saleId}/fiscal`) });
  const [emitting, setEmitting] = useState(false);
  const reload = () => {
    client.invalidateQueries({ queryKey: ['sale-fiscal', saleId] });
    client.invalidateQueries({ queryKey: ['sale', saleId] });
    client.invalidateQueries({ queryKey: ['fiscal-documents'] });
  };
  if (!q.data) return null;
  const p = q.data;
  // Loja sem fiscal configurado e sem nota: o bloco nem aparece para quem não configura.
  if (!p.ready && !p.documents.length && !can('settings.manage')) return null;
  const active = p.documents.some((d) => d.status === 'authorized' || d.status === 'processing');
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Nota fiscal</h2>
        {p.ready && !active && can('fiscal.emit') && (
          <button className="btn-ghost" onClick={() => setEmitting(true)}>
            Emitir NFC-e
          </button>
        )}
      </div>
      {!p.ready && (
        <p className="text-sm text-ink-soft">
          A emissão de nota ainda não está ligada nesta loja.{' '}
          {can('settings.manage') && (
            <Link className="text-brand" to="/configuracoes/fiscal">
              Configurar
            </Link>
          )}
        </p>
      )}
      {p.ready && !p.documents.length && <p className="text-sm text-ink-soft">Nenhuma nota emitida para esta venda.</p>}
      {p.documents.length > 0 && (
        <div className="overflow-x-auto">
          <FiscalTable rows={p.documents} onChanged={reload} />
        </div>
      )}
      {emitting && (
        <EmitDrawer
          saleId={saleId}
          preview={p}
          onClose={() => setEmitting(false)}
          onDone={() => {
            setEmitting(false);
            reload();
          }}
        />
      )}
    </section>
  );
}

function EmitDrawer({ saleId, preview: p, onClose, onDone }: { saleId: string; preview: FiscalPreview; onClose: () => void; onDone: () => void }) {
  const [includeCustomer, setInclude] = useState(Boolean(p.customer.document));
  const [error, setError] = useState<unknown>(null);
  const emit = useMutation({
    mutationFn: () => api<FiscalDocument>(`/sales/${saleId}/fiscal/nfce`, { method: 'POST', json: { includeCustomer } }),
    onSuccess: onDone,
    onError: setError,
  });
  return (
    <Drawer title="Emitir NFC-e" onClose={onClose} wide>
      <div className="space-y-4">
        {p.environment === 'homologacao' && <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">Ambiente de teste (homologação): esta nota não tem valor fiscal.</div>}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>NCM</th>
                <th className="text-right">Qtd.</th>
                <th className="text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((i, n) => (
                <tr key={n}>
                  <td>{i.description}</td>
                  <td className={`tabular-nums ${i.ncm ? '' : 'text-red-600'}`}>{i.ncm ?? 'falta'}</td>
                  <td className="text-right tabular-nums">{i.quantity}</td>
                  <td className="text-right tabular-nums">{formatMoney(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.excluded.length > 0 && (
          <p className="text-sm text-ink-soft">
            Fica fora da nota: {p.excluded.map((e) => e.description).join(', ')}. {p.excluded[0]!.reason}
          </p>
        )}
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between font-semibold">
            <span>Total da nota</span>
            <span className="tabular-nums">{formatMoney(p.total)}</span>
          </div>
          {p.payments.map((pay) => (
            <div key={pay.kind} className="flex justify-between text-ink-soft">
              <span>{pay.label}</span>
              <span className="tabular-nums">{formatMoney(pay.amount)}</span>
            </div>
          ))}
        </div>
        <label className={`flex items-start gap-2 text-sm ${p.customer.document ? '' : 'text-ink-soft'}`}>
          <input type="checkbox" className="mt-0.5" checked={includeCustomer} disabled={!p.customer.document} onChange={(e) => setInclude(e.target.checked)} />
          <span>
            CPF/CNPJ na nota
            <span className="block text-xs text-ink-soft">{p.customer.document ? `${p.customer.name} · ${p.customer.document}` : `${p.customer.name} não tem CPF no cadastro.`}</span>
          </span>
        </label>
        {p.problems.length > 0 && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <strong>Antes de emitir:</strong>
            <ul className="mt-1 list-disc pl-5">
              {p.problems.map((m, n) => (
                <li key={n}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={emit.isPending || p.problems.length > 0} onClick={() => emit.mutate()}>
          {emit.isPending ? 'Enviando para a SEFAZ…' : 'Emitir NFC-e'}
        </button>
      </div>
    </Drawer>
  );
}
