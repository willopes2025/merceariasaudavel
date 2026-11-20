import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerSchema, formatPhone, type Customer, type CustomerRow, type Page } from '@mercearia/contracts';
import { api, can } from '../lib/api';
import { ErrorBox, Field } from './ui';

/**
 * Acha um cliente pelo nome, CPF ou telefone, ou cadastra na hora só com
 * nome e WhatsApp (o resto se completa depois na ficha).
 */
export function CustomerPicker({ onPick, busy }: { onPick: (customer: { id: string; name: string }) => void; busy?: boolean }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ['customer-picker', debounced],
    queryFn: () => api<Page<CustomerRow>>(`/customers?q=${encodeURIComponent(debounced)}&pageSize=10`),
    enabled: debounced.length >= 2,
  });

  async function create() {
    const parsed = customerSchema.safeParse({ name, phone });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    try {
      const c = await api<Customer>('/customers', { method: 'POST', json: parsed.data });
      onPick({ id: c.id, name: c.name });
    } catch (e) {
      setError(e);
    }
  }

  if (creating) {
    return (
      <div className="space-y-3">
        <Field label="Nome completo">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="WhatsApp">
          <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
            Voltar à busca
          </button>
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={create}>
            Cadastrar e continuar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Nome, CPF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Buscar cliente" />
      {debounced.length >= 2 && (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {results.data?.items.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={busy} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onPick({ id: c.id, name: c.name })}>
                <span className="font-medium">{c.name}</span>
                <span className="ml-2 text-ink-soft">{c.phone ? formatPhone(c.phone) : ''}</span>
              </button>
            </li>
          ))}
          {results.data && results.data.items.length === 0 && <li className="px-3 py-2 text-sm text-ink-soft">Ninguém encontrado.</li>}
        </ul>
      )}
      {can('customer.manage') && (
        <button
          type="button"
          className="text-sm text-brand underline"
          onClick={() => {
            setCreating(true);
            if (!/\d/.test(q)) setName(q);
            else setPhone(q);
          }}
        >
          Não achou? Cadastrar cliente novo
        </button>
      )}
    </div>
  );
}
