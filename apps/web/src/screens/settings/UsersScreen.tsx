import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userCreateSchema, userUpdateSchema, type RoleRow, type Store, type UserRow } from '@mercearia/contracts';
import { api, session } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader, Status } from '../../components/ui';

export function UsersScreen() {
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const storeName = (id: string) => stores.data?.find((s) => s.id === id)?.name ?? '';

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Usuários"
        subtitle="Quem acessa o Mercearia, com que papel e em quais lojas."
        action={<button className="btn-primary" onClick={() => setEditing('new')}>Novo usuário</button>}
      />
      <div className="card overflow-x-auto">
        {users.isLoading ? (
          <Loading />
        ) : !users.data?.length ? (
          <Empty>Nenhum usuário.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Papel</th>
                <th>Lojas</th>
                <th>Último acesso</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(u)}>
                  <td>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-ink-soft">{u.email}</p>
                  </td>
                  <td>{u.roleName ?? '—'}</td>
                  <td>{u.storeIds.length ? u.storeIds.map(storeName).join(', ') : 'Todas'}</td>
                  <td className="text-ink-soft">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td>
                    <Status active={u.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          roles={roles.data ?? []}
          stores={stores.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void client.invalidateQueries({ queryKey: ['users'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function UserForm({
  user,
  roles,
  stores,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  roles: RoleRow[];
  stores: Store[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isSelf = user?.id === session.user()?.id;
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    whatsapp: user?.whatsapp ?? '',
    password: '',
    roleCode: user?.roleCode ?? 'seller',
    storeIds: user?.storeIds ?? [],
    active: user?.active ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => api<UserRow>(user ? `/users/${user.id}` : '/users', { method: user ? 'PUT' : 'POST', json: body }),
    onSuccess: onSaved,
    onError: setError,
  });
  const role = roles.find((r) => r.code === form.roleCode);

  function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...form, whatsapp: form.whatsapp || null, password: form.password || undefined };
    const parsed = user ? userUpdateSchema.safeParse(payload) : userCreateSchema.safeParse(payload);
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    setError(null);
    save.mutate(parsed.data);
  }

  const toggleStore = (id: string) =>
    setForm({ ...form, storeIds: form.storeIds.includes(id) ? form.storeIds.filter((s) => s !== id) : [...form.storeIds, id] });

  return (
    <Drawer title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="E-mail (login)">
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="WhatsApp">
          <input className="input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
        </Field>
        <Field label={user ? 'Nova senha' : 'Senha'} hint={user ? 'Deixe em branco para manter a atual.' : 'Mínimo de 8 caracteres.'}>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Papel" hint={role?.description ?? undefined}>
          <select className="input" value={form.roleCode} disabled={isSelf} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
            {roles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend className="label">Lojas</legend>
          <p className="mb-2 text-xs text-ink-soft">Nenhuma marcada = todas as lojas.</p>
          <div className="space-y-1">
            {stores.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.storeIds.includes(s.id)} onChange={() => toggleStore(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
        {user && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} disabled={isSelf} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Acesso ativo
          </label>
        )}
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Drawer>
  );
}
