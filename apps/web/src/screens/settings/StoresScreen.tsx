import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storeSchema, type Store } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader, Status } from '../../components/ui';

const blank = { code: '', name: '', cnpj: '', phone: '', address: '', active: true, stockStoreId: null as string | null };

function formatCnpj(v: string | null): string {
  if (!v) return '—';
  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function StoresScreen() {
  const client = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [editing, setEditing] = useState<Store | 'new' | null>(null);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Lojas"
        subtitle="Cada loja tem caixa e equipe próprios. O estoque pode ser próprio ou dividido com outra loja."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>Nova loja</button>}
      />
      <div className="card overflow-x-auto">
        {stores.isLoading ? (
          <Loading />
        ) : !stores.data?.length ? (
          <Empty>Nenhuma loja cadastrada.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Código</th>
                <th>CNPJ</th>
                <th>Telefone</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {stores.data.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(s)}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-ink-soft">{s.code}</td>
                  <td>{formatCnpj(s.cnpj)}</td>
                  <td>{s.phone ?? '—'}</td>
                  <td>
                    <Status active={s.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <StoreForm
          stores={stores.data ?? []}
          store={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void client.invalidateQueries({ queryKey: ['stores'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function StoreForm({ store, stores, onClose, onSaved }: { store: Store | null; stores: Store[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() =>
    store ? { ...store, cnpj: store.cnpj ?? '', phone: store.phone ?? '', address: store.address ?? '' } : blank,
  );
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => api<Store>(store ? `/stores/${store.id}` : '/stores', { method: store ? 'PUT' : 'POST', json: body }),
    onSuccess: onSaved,
    onError: setError,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = storeSchema.safeParse(form);
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    setError(null);
    save.mutate(parsed.data);
  }

  const set = (k: 'name' | 'code' | 'cnpj' | 'phone' | 'address') => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Drawer title={store ? 'Editar loja' : 'Nova loja'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome">
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Código" hint="Curto, sem espaço. Ex.: programa-seven">
          <input className="input" value={form.code} onChange={set('code')} />
        </Field>
        <Field label="CNPJ">
          <input className="input" value={form.cnpj} onChange={set('cnpj')} inputMode="numeric" />
        </Field>
        <Field label="Telefone">
          <input className="input" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Endereço">
          <input className="input" value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Estoque" hint="Se duas lojas vendem as mesmas peças do mesmo estoque, aponte uma para a outra.">
          <select className="input" value={form.stockStoreId ?? ''} onChange={(e) => setForm({ ...form, stockStoreId: e.target.value || null })}>
            <option value="">Estoque próprio</option>
            {stores.filter((s) => s.id !== store?.id && !s.stockStoreId).map((s) => (
              <option key={s.id} value={s.id}>
                Usa o estoque de {s.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Loja ativa
        </label>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Drawer>
  );
}
