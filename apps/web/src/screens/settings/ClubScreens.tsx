import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categorySchema, clubSettingsSchema, type Category, type ClubSettings } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';

/** Regras do clube: cashback e quanto dá para usar por compra. */
export function ClubScreen() {
  const client = useQueryClient();
  const club = useQuery({ queryKey: ['club'], queryFn: () => api<ClubSettings>('/club') });
  const [f, setF] = useState({ cashbackPct: '', cashbackDays: '', cashbackMaxUsePct: '', ordersEnabled: true, kitchenFromCounter: true });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (club.data) setF({ cashbackPct: String(club.data.cashbackPct).replace('.', ','), cashbackDays: String(club.data.cashbackDays), cashbackMaxUsePct: String(club.data.cashbackMaxUsePct).replace('.', ','), ordersEnabled: club.data.ordersEnabled, kitchenFromCounter: club.data.kitchenFromCounter });
  }, [club.data]);
  const save = useMutation({ mutationFn: (body: unknown) => api('/club', { method: 'PUT', json: body }), onSuccess: () => { setSaved(true); client.invalidateQueries({ queryKey: ['club'] }); }, onError: setError });
  if (club.isLoading) return <Loading />;
  return (
    <div className="max-w-xl">
      <PageHeader title="Clube, cashback e pedidos" subtitle="Ser membro é grátis: cadastro com celular no caixa ou pelo app. Membro paga o preço de membro e junta cashback." />
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          const parsed = clubSettingsSchema.safeParse(f);
          if (!parsed.success) return setError(parsed.error.issues[0]?.message);
          setError(null);
          save.mutate(parsed.data);
        }}
      >
        <Field label="Cashback (% do valor pago que volta para o membro)" hint="0 = sem cashback. Só membro ganha.">
          <input className="input" inputMode="decimal" value={f.cashbackPct} onChange={(e) => setF({ ...f, cashbackPct: e.target.value })} />
        </Field>
        <Field label="Validade do cashback (dias)" hint="0 = não vence. Vencido é baixado de madrugada.">
          <input className="input" inputMode="numeric" value={f.cashbackDays} onChange={(e) => setF({ ...f, cashbackDays: e.target.value })} />
        </Field>
        <Field label="Até quanto da compra pode ser pago com cashback (%)">
          <input className="input" inputMode="decimal" value={f.cashbackMaxUsePct} onChange={(e) => setF({ ...f, cashbackMaxUsePct: e.target.value })} />
        </Field>
        <div className="space-y-2 border-t border-slate-100 pt-4 text-sm">
          <p className="font-medium">Pedidos e tela de preparo</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={f.ordersEnabled} onChange={(e) => setF({ ...f, ordersEnabled: e.target.checked })} />
            <span>App e totem aceitam pedido (a cliente paga no caixa). Desligue em dia de movimento fora do normal.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={f.kitchenFromCounter} onChange={(e) => setF({ ...f, kitchenFromCounter: e.target.checked })} />
            <span>Venda no balcão com shake ou sorvete vai para a tela de preparo.</span>
          </label>
        </div>
        <ErrorBox error={error} />
        {saved && <p className="text-sm text-brand">Regras salvas.</p>}
        <button className="btn-primary w-full" disabled={save.isPending}>
          Salvar
        </button>
      </form>
    </div>
  );
}

export function CategoriesScreen() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['categories'] });
  const create = useMutation({ mutationFn: (body: unknown) => api('/categories', { method: 'POST', json: body }), onSuccess: () => { setName(''); refresh(); }, onError: setError });
  const update = useMutation({ mutationFn: (c: Category & { name: string }) => api(`/categories/${c.id}`, { method: 'PUT', json: { name: c.name, active: c.active } }), onSuccess: refresh, onError: setError });
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Categorias" subtitle="Organizam o catálogo, o caixa, os relatórios e as metas por categoria." />
      <form
        className="card flex gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = categorySchema.safeParse({ name });
          if (!parsed.success) return setError(parsed.error.issues[0]?.message);
          create.mutate(parsed.data);
        }}
      >
        <input className="input" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary">Criar</button>
      </form>
      <ErrorBox error={error} />
      <div className="card">
        {!list.data?.length ? (
          <Empty>Nenhuma categoria.</Empty>
        ) : (
          <table className="table">
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      className="input border-transparent"
                      defaultValue={c.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && update.mutate({ ...c, name: e.target.value.trim() })}
                      aria-label="Nome da categoria"
                    />
                  </td>
                  <td className="text-sm text-ink-soft">{c.products} produtos</td>
                  <td className="text-right">
                    <button className="text-sm text-ink-soft" onClick={() => update.mutate({ ...c, active: !c.active })}>
                      {c.active ? 'Desativar' : 'Ativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
