import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOSS_REASONS,
  PRODUCT_KINDS,
  STOCK_MOVEMENT_TYPES,
  UNITS,
  productSchema,
  optionGroupsSchema,
  recipeSchema,
  stockMoveSchema,
  stockStores,
  type Category,
  type Page,
  type Product,
  type ProductDetail,
  type ProductForm,
  type Store,
} from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime, formatDay, formatMoney, formatQty } from '../../components/format';
import { StockEntryDrawer } from './StockEntryDrawer';

const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
const useStores = () => useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });

/** Produtos e estoque. `stockView` abre no que está abaixo do mínimo. */
export function ProductsScreen({ stockView = false }: { stockView?: boolean }) {
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stock, setStock] = useState<'all' | 'low' | 'out'>(stockView ? 'low' : 'all');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, kind, categoryId, stock, status]);
  const params = new URLSearchParams({ status, stock, page: String(page), pageSize: '50' });
  if (debounced) params.set('q', debounced);
  if (kind) params.set('kind', kind);
  if (categoryId) params.set('categoryId', categoryId);
  const list = useQuery({ queryKey: ['products', params.toString()], queryFn: () => api<Page<Product>>(`/products?${params}`) });
  const categories = useCategories();
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['products'] });
    client.invalidateQueries({ queryKey: ['product'] });
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={stockView ? 'Estoque' : 'Produtos'}
        subtitle={
          stockView
            ? 'O que está abaixo do mínimo. Clique no produto para dar entrada (com lote e validade), lançar perda ou acertar.'
            : 'Revenda, insumos e preparados (shakes e sorvetes com ficha técnica). Preço de membro vale para quem é do clube.'
        }
        action={
          <div className="flex gap-2">
            {can('stock.adjust') && (
              <button className="btn-ghost" onClick={() => setEntering(true)}>
                Entrada por XML
              </button>
            )}
            {can('product.manage') && (
              <button className="btn-primary" onClick={() => setEditing('new')}>
                Novo produto
              </button>
            )}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Nome, marca ou código de barras" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(PRODUCT_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.split(' (')[0]}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={stock} onChange={(e) => setStock(e.target.value as typeof stock)} aria-label="Estoque">
          <option value="all">Qualquer estoque</option>
          <option value="low">Abaixo do mínimo</option>
          <option value="out">Zerado ou negativo</option>
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="active">Ativos</option>
          <option value="inactive">Desativados</option>
          <option value="all">Todos</option>
        </select>
      </div>
      <ErrorBox error={list.error} />
      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>{debounced || kind || stock !== 'all' ? 'Nenhum produto com esses filtros.' : 'Nenhum produto cadastrado ainda.'}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Tipo</th>
                <th className="text-right">Preço</th>
                <th className="text-right">Membro</th>
                <th className="text-right">Custo</th>
                <th className="text-right">Estoque</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => {
                const cost = p.recipeCost ?? p.cost;
                return (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(p.id)}>
                    <td>
                      <span className="font-medium">{p.name}</span>
                      {!p.active && <span className="badge ml-2 bg-slate-100 text-slate-500">Desativado</span>}
                      <div className="text-xs text-ink-soft">{[p.categoryName, p.brand, p.barcode].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{PRODUCT_KINDS[p.kind].split(' (')[0]}</td>
                    <td className="text-right tabular-nums">
                      {formatMoney(p.price)}
                      {p.unit !== 'UN' && <span className="text-xs text-ink-soft">/{p.unit.toLowerCase()}</span>}
                    </td>
                    <td className="text-right tabular-nums text-brand">{p.memberPrice != null ? formatMoney(p.memberPrice) : '—'}</td>
                    <td className="text-right tabular-nums text-ink-soft">
                      {formatMoney(cost)}
                      {p.price > 0 && cost > 0 && <div className="text-xs">margem {Math.round(((p.price - cost) / p.price) * 100)}%</div>}
                    </td>
                    <td className={`text-right tabular-nums ${p.trackStock && (p.totalStock <= 0 || p.low) ? 'font-medium text-red-600' : ''}`}>
                      {p.trackStock ? formatQty(p.totalStock, p.unit === 'UN' ? undefined : p.unit) : p.kind === 'preparado' ? 'pela ficha' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span className="self-center">
            {page} de {pages}
          </span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </div>
      )}
      {editing && (
        <ProductFormDrawer
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            refresh();
            setEditing(null);
            setViewing(p.id);
          }}
        />
      )}
      {viewing && <ProductDrawer id={viewing} onClose={() => setViewing(null)} onEdit={(p) => { setViewing(null); setEditing(p); }} onChanged={refresh} />}
      {entering && <StockEntryDrawer onClose={() => setEntering(false)} onDone={() => { refresh(); setEntering(false); }} />}
    </div>
  );
}

const empty: ProductForm = { name: '', kind: 'revenda', categoryId: null, brand: '', sku: '', barcode: '', unit: 'UN', soldByWeight: false, price: '' as unknown as number, memberPrice: null, cost: '' as unknown as number, trackStock: true, trackLots: false, minStock: 0, sellable: true, ncm: '', cest: '', supplier: '', description: '', imageUrl: '', showInApp: true, repurchaseDays: null, active: true };

function ProductFormDrawer({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: (p: ProductDetail) => void }) {
  const categories = useCategories();
  const [f, setF] = useState<ProductForm>(() =>
    product
      ? { ...product, memberPrice: product.memberPrice, price: String(product.price).replace('.', ',') as unknown as number, cost: String(product.cost).replace('.', ',') as unknown as number }
      : empty,
  );
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: (body: unknown) => (product ? api<ProductDetail>(`/products/${product.id}`, { method: 'PUT', json: body }) : api<ProductDetail>('/products', { method: 'POST', json: body })),
    onSuccess: onSaved,
    onError: setError,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = productSchema.safeParse(f);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(null);
    save.mutate(parsed.data);
  }
  const prepared = f.kind === 'preparado';
  return (
    <Drawer title={product ? 'Editar produto' : 'Novo produto'} onClose={onClose} wide>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2">
          <Field label="Nome">
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
        </div>
        <Field label="Tipo" hint={prepared ? 'Não tem estoque: a venda baixa os insumos da ficha técnica.' : f.kind === 'insumo' ? 'Usado no preparo. Pode ou não ser vendido avulso.' : undefined}>
          <select className="input" value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value as ProductForm['kind'], sellable: e.target.value !== 'insumo', trackStock: e.target.value !== 'preparado' }))}>
            {Object.entries(PRODUCT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoria">
          <select className="input" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
            <option value="">Sem categoria</option>
            {categories.data?.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Código de barras (EAN)">
          <input className="input" value={f.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} placeholder="Passe o leitor aqui" />
        </Field>
        <Field label="Código interno">
          <input className="input" value={f.sku ?? ''} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Marca">
          <input className="input" value={f.brand ?? ''} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label="Unidade">
          <select className="input" value={f.unit} onChange={(e) => set('unit', e.target.value as ProductForm['unit'])}>
            {Object.entries(UNITS).map(([k, v]) => (
              <option key={k} value={k}>
                {k} · {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Preço de venda (R$)">
          <input className="input" inputMode="decimal" value={String(f.price ?? '')} onChange={(e) => set('price', e.target.value as unknown as number)} />
        </Field>
        <Field label="Preço de membro (R$)" hint="Vazio = mesmo preço para todos. É o que faz a cliente entrar no clube.">
          <input className="input" inputMode="decimal" value={f.memberPrice == null ? '' : String(f.memberPrice).replace('.', ',')} onChange={(e) => set('memberPrice', (e.target.value || null) as unknown as number | null)} />
        </Field>
        {!prepared && (
          <Field label="Custo (R$)" hint="A entrada de mercadoria atualiza com o custo da última compra.">
            <input className="input" inputMode="decimal" value={String(f.cost ?? '')} onChange={(e) => set('cost', e.target.value as unknown as number)} />
          </Field>
        )}
        {!prepared && (
          <Field label={`Estoque mínimo (${(f.unit ?? 'UN').toLowerCase()})`} hint="Abaixo disso aparece no painel.">
            <input className="input" inputMode="decimal" value={String(f.minStock ?? '')} onChange={(e) => set('minStock', e.target.value as unknown as number)} />
          </Field>
        )}
        <Field label="NCM (nota fiscal)">
          <input className="input" inputMode="numeric" value={f.ncm ?? ''} onChange={(e) => set('ncm', e.target.value)} placeholder="8 números" />
        </Field>
        <Field label="CEST">
          <input className="input" inputMode="numeric" value={f.cest ?? ''} onChange={(e) => set('cest', e.target.value)} />
        </Field>
        {f.kind === 'revenda' && (
          <Field label="Dura em média (dias)" hint="Para o aviso de recompra: whey 900 g ≈ 30. Vazio = usa o ritmo de cada cliente.">
            <input className="input" inputMode="numeric" value={f.repurchaseDays == null ? '' : String(f.repurchaseDays)} onChange={(e) => set('repurchaseDays', e.target.value.replace(/\D/g, '') || null)} />
          </Field>
        )}
        {f.kind !== 'insumo' && (
          <>
            <div className="sm:col-span-2">
              <Field label="Descrição no app e no cardápio" hint="Uma ou duas frases: sabor, para quem é, o que tem de bom.">
                <textarea className="input min-h-[64px]" maxLength={400} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Foto (link https)" hint="Cole o link da imagem (site do fabricante, Drive público…). Vazio = ícone da loja.">
                <div className="flex gap-3">
                  <input className="input flex-1" value={f.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" />
                  {f.imageUrl && /^https:\/\//.test(f.imageUrl) && <img src={f.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />}
                </div>
              </Field>
            </div>
          </>
        )}
        <div className="flex flex-col gap-2 text-sm sm:col-span-2">
          {f.kind !== 'insumo' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.showInApp !== false} onChange={(e) => set('showInApp', e.target.checked)} />
              Aparece no app e no cardápio
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(f.soldByWeight)} onChange={(e) => setF((x) => ({ ...x, soldByWeight: e.target.checked, unit: e.target.checked ? 'KG' : x.unit }))} />
            Vendido na balança (granel, por kg)
          </label>
          {!prepared && (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={Boolean(f.trackStock)} onChange={(e) => set('trackStock', e.target.checked)} />
                Controla estoque
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={Boolean(f.trackLots)} disabled={!f.trackStock} onChange={(e) => set('trackLots', e.target.checked)} />
                Controla lote e validade (sai primeiro o que vence primeiro)
              </label>
            </>
          )}
          {f.kind === 'insumo' && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(f.sellable)} onChange={(e) => set('sellable', e.target.checked)} />
              Também é vendido avulso no caixa
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(f.active)} onChange={(e) => set('active', e.target.checked)} />
            Ativo
          </label>
        </div>
        <div className="sm:col-span-2">
          <ErrorBox error={error} />
          <button className="btn-primary mt-2 w-full" disabled={save.isPending}>
            Salvar
          </button>
        </div>
      </form>
    </Drawer>
  );
}

type MoveType = 'entrada' | 'perda' | 'ajuste' | 'transferencia';

function ProductDrawer({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (p: Product) => void; onChanged: () => void }) {
  const client = useQueryClient();
  const product = useQuery({ queryKey: ['product', id], queryFn: () => api<ProductDetail>(`/products/${id}`) });
  const stores = useStores();
  const [move, setMove] = useState<MoveType | null>(null);
  const [recipe, setRecipe] = useState(false);
  const [options, setOptions] = useState(false);
  const p = product.data;
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['product', id] });
    onChanged();
  };
  const stockStoreList = stockStores((stores.data ?? []).filter((s) => s.active));
  return (
    <Drawer title={p?.name ?? 'Produto'} onClose={onClose} wide>
      {!p ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-sm">
              <p>
                {PRODUCT_KINDS[p.kind]} {p.categoryName && `· ${p.categoryName}`}
              </p>
              <p className="text-ink-soft">{[p.barcode && `EAN ${p.barcode}`, p.sku && `cód. ${p.sku}`, p.ncm && `NCM ${p.ncm}`].filter(Boolean).join(' · ') || 'Sem código'}</p>
              <p className="mt-1">
                {formatMoney(p.price)} {p.memberPrice != null && <span className="text-brand">· membro {formatMoney(p.memberPrice)}</span>}
              </p>
            </div>
            {can('product.manage') && (
              <button className="btn-ghost" onClick={() => onEdit(p)}>
                Editar
              </button>
            )}
          </div>

          {p.kind === 'preparado' ? (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Ficha técnica</h3>
                {can('product.manage') && (
                  <button className="text-sm text-brand" onClick={() => setRecipe(true)}>
                    {p.recipe.length ? 'Editar ficha' : 'Montar ficha'}
                  </button>
                )}
              </div>
              {!p.recipe.length ? (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Sem ficha técnica o caixa não vende este preparado.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {p.recipe.map((r) => (
                      <tr key={r.ingredientId}>
                        <td>{r.ingredientName}</td>
                        <td className="text-right tabular-nums">{formatQty(r.quantity, r.unit)}</td>
                        <td className="text-right tabular-nums text-ink-soft">{formatMoney(r.cost)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="font-medium">Custo do preparado</td>
                      <td />
                      <td className="text-right font-medium tabular-nums">
                        {formatMoney(p.recipeCost ?? 0)}
                        {p.price > 0 && <div className="text-xs font-normal text-ink-soft">margem {Math.round(((p.price - (p.recipeCost ?? 0)) / p.price) * 100)}%{p.memberPrice ? ` · membro ${Math.round(((p.memberPrice - (p.recipeCost ?? 0)) / p.memberPrice) * 100)}%` : ''}</div>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>
          ) : (
            p.trackStock && (
              <section>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">Estoque: {formatQty(p.totalStock, p.unit)}</h3>
                  <div className="flex flex-wrap gap-2">
                    {can('stock.adjust') && (
                      <button className="btn-ghost px-3 py-1" onClick={() => setMove('entrada')}>
                        Entrada
                      </button>
                    )}
                    {can('stock.loss') && (
                      <button className="btn-ghost px-3 py-1" onClick={() => setMove('perda')}>
                        Perda
                      </button>
                    )}
                    {can('stock.adjust') && (
                      <button className="btn-ghost px-3 py-1" onClick={() => setMove('ajuste')}>
                        Acerto
                      </button>
                    )}
                    {can('stock.adjust') && stockStoreList.length > 1 && (
                      <button className="btn-ghost px-3 py-1" onClick={() => setMove('transferencia')}>
                        Transferir
                      </button>
                    )}
                  </div>
                </div>
                {p.lots.length > 0 && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Lote</th>
                        <th>Validade</th>
                        <th className="text-right">Qtd.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.lots.map((l) => (
                        <tr key={l.id}>
                          <td>{l.code}</td>
                          <td className={l.daysLeft != null && l.daysLeft <= 15 ? 'font-medium text-red-600' : ''}>
                            {formatDay(l.expiresAt)} {l.daysLeft != null && <span className="text-xs">({l.daysLeft < 0 ? 'vencido' : `${l.daysLeft} dias`})</span>}
                          </td>
                          <td className="text-right tabular-nums">{formatQty(l.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )
          )}

          {p.kind !== 'insumo' && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">Montagem (sabor, adicionais)</h3>
                {can('product.manage') && !options && (
                  <button className="text-sm text-brand" onClick={() => setOptions(true)}>
                    {p.optionGroups.length ? 'Editar montagem' : 'Montar opções'}
                  </button>
                )}
              </div>
              {options ? (
                <OptionsForm product={p} onClose={() => setOptions(false)} onDone={() => { setOptions(false); refresh(); }} />
              ) : !p.optionGroups.length ? (
                <p className="text-sm text-ink-soft">Sem montagem: vende do jeito que está. Use para sabor do shake, cobertura do sorvete, adicionais pagos.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {p.optionGroups.map((g) => (
                    <div key={g.id}>
                      <p className="font-medium">
                        {g.name} <span className="text-xs font-normal text-ink-soft">({g.minSelect > 0 ? `obrigatório, ${g.minSelect === g.maxSelect ? g.maxSelect : `${g.minSelect} a ${g.maxSelect}`}` : `opcional, até ${g.maxSelect}`})</span>
                      </p>
                      <p className="text-ink-soft">
                        {g.options.map((o) => `${o.name}${o.price > 0 ? ` +${formatMoney(o.price)}` : ''}${o.supplyName ? ` (gasta ${formatQty(o.supplyQty ?? 0, o.supplyUnit ?? 'UN')} de ${o.supplyName})` : ''}`).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {p.usedIn.length > 0 && (
            <p className="text-sm text-ink-soft">
              Entra na ficha de: {p.usedIn.map((u) => `${u.name} (${formatQty(u.quantity, p.unit)})`).join(', ')}
            </p>
          )}

          {move && <MoveForm product={p} type={move} stores={stockStoreList} onClose={() => setMove(null)} onDone={() => { setMove(null); refresh(); }} />}
          {recipe && <RecipeForm product={p} onClose={() => setRecipe(false)} onDone={() => { setRecipe(false); refresh(); }} />}

          {p.movements.length > 0 && (
            <section>
              <h3 className="mb-2 font-medium">Movimentações</h3>
              <table className="table">
                <tbody>
                  {p.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs text-ink-soft">{formatDateTime(m.at)}</td>
                      <td>
                        {STOCK_MOVEMENT_TYPES[m.type]}
                        {m.reason && ` · ${LOSS_REASONS[m.reason]}`}
                        {m.saleNumber && ` · venda ${m.saleNumber}`}
                        {m.lotCode && <span className="text-xs text-ink-soft"> · lote {m.lotCode}</span>}
                        {m.note && <div className="text-xs text-ink-soft">{m.note}</div>}
                      </td>
                      <td className={`text-right tabular-nums ${m.delta < 0 ? 'text-red-600' : 'text-brand'}`}>{m.delta > 0 ? `+${formatQty(m.delta)}` : formatQty(m.delta)}</td>
                      <td className="text-right tabular-nums text-ink-soft">{formatQty(m.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function MoveForm({ product, type, stores, onClose, onDone }: { product: ProductDetail; type: MoveType; stores: Store[]; onClose: () => void; onDone: () => void }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [toStoreId, setToStoreId] = useState(stores[1]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [lotId, setLotId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (body: unknown) => api(`/products/${product.id}/stock`, { method: 'POST', json: body }), onSuccess: onDone, onError: setError });
  const title = { entrada: 'Entrada de mercadoria', perda: 'Lançar perda', ajuste: 'Acerto (quanto tem na prateleira)', transferencia: 'Transferir entre lojas' }[type];
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { type, storeId, toStoreId, quantity, lotCode: lotCode || null, expiresAt: expiresAt || null, unitCost: unitCost || undefined, reason: reason || undefined, lotId: lotId || null, note: note || null };
    const parsed = stockMoveSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    save.mutate(parsed.data);
  }
  return (
    <form className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4" onSubmit={submit}>
      <p className="font-medium">{title}</p>
      {stores.length > 1 && (
        <Field label="Loja">
          <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {type === 'transferencia' && (
        <Field label="Para a loja">
          <select className="input" value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
            {stores.filter((s) => s.id !== storeId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={`Quantidade (${product.unit.toLowerCase()})`}>
        <input className="input" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
      </Field>
      {type === 'entrada' && (
        <>
          {product.trackLots && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lote">
                <input className="input" value={lotCode} onChange={(e) => setLotCode(e.target.value)} />
              </Field>
              <Field label="Validade">
                <input type="date" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Custo unitário desta compra (R$)" hint="Opcional. Atualiza o custo do produto.">
            <input className="input" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
        </>
      )}
      {type === 'perda' && (
        <>
          <Field label="Motivo">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Escolha…</option>
              {Object.entries(LOSS_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {product.lots.length > 0 && (
            <Field label="Lote">
              <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">O que vence primeiro</option>
                {product.lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · vence {formatDay(l.expiresAt)} · {formatQty(l.quantity)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      <Field label="Observação">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn-primary" disabled={save.isPending}>
          Lançar
        </button>
      </div>
    </form>
  );
}

function RecipeForm({ product, onClose, onDone }: { product: ProductDetail; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState(product.recipe.map((r) => ({ ingredientId: r.ingredientId, name: r.ingredientName, unit: r.unit, quantity: String(r.quantity).replace('.', ',') })));
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  const found = useQuery({
    queryKey: ['recipe-search', q],
    queryFn: () => api<Page<Product>>(`/products?q=${encodeURIComponent(q)}&pageSize=10`),
    enabled: q.trim().length >= 2,
  });
  const save = useMutation({ mutationFn: (body: unknown) => api(`/products/${product.id}/recipe`, { method: 'PUT', json: body }), onSuccess: onDone, onError: setError });
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="font-medium">Ficha técnica de 1 {product.name}</p>
      <p className="text-xs text-ink-soft">Quantidade na unidade do insumo: 30 g de whey controlado em KG = 0,030; 250 ml de leite em L = 0,25.</p>
      {items.map((i, n) => (
        <div key={i.ingredientId} className="flex items-center gap-2">
          <span className="flex-1 text-sm">{i.name}</span>
          <input className="input w-28 text-right" inputMode="decimal" value={i.quantity} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, quantity: e.target.value } : x)))} />
          <span className="w-8 text-xs text-ink-soft">{i.unit.toLowerCase()}</span>
          <button className="text-xs text-red-600" onClick={() => setItems((xs) => xs.filter((_, k) => k !== n))}>
            Tirar
          </button>
        </div>
      ))}
      <input className="input" placeholder="Buscar insumo para acrescentar" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.data?.items
        .filter((p) => p.kind !== 'preparado' && !items.some((i) => i.ingredientId === p.id))
        .map((p) => (
          <button key={p.id} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-white" onClick={() => { setItems((xs) => [...xs, { ingredientId: p.id, name: p.name, unit: p.unit, quantity: '' }]); setQ(''); }}>
            + {p.name} <span className="text-xs text-ink-soft">({p.unit.toLowerCase()} · custo {formatMoney(p.cost)})</span>
          </button>
        ))}
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => {
            const parsed = recipeSchema.safeParse({ items: items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity })) });
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            save.mutate(parsed.data);
          }}
        >
          Salvar ficha
        </button>
      </div>
    </div>
  );
}

interface OptionDraft {
  id: string | null;
  name: string;
  price: string;
  supplyId: string;
  supplyQty: string;
}
interface GroupDraft {
  id: string | null;
  name: string;
  minSelect: string;
  maxSelect: string;
  options: OptionDraft[];
}

/**
 * Montagem: grupos como "Sabor" (obrigatório, escolhe 1) e "Adicionais"
 * (opcional, até 3). Cada opção pode custar a mais e gastar um insumo.
 */
function OptionsForm({ product, onClose, onDone }: { product: ProductDetail; onClose: () => void; onDone: () => void }) {
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    product.optionGroups.length
      ? product.optionGroups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: String(g.minSelect),
          maxSelect: String(g.maxSelect),
          options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price ? String(o.price).replace('.', ',') : '', supplyId: o.supplyId ?? '', supplyQty: o.supplyQty != null ? String(o.supplyQty).replace('.', ',') : '' })),
        }))
      : [{ id: null, name: 'Sabor', minSelect: '1', maxSelect: '1', options: [{ id: null, name: '', price: '', supplyId: '', supplyQty: '' }] }],
  );
  const [error, setError] = useState<unknown>(null);
  const supplies = useQuery({ queryKey: ['option-supplies'], queryFn: () => api<Page<Product>>('/products?kind=insumo&pageSize=200') });
  const resale = useQuery({ queryKey: ['option-resale'], queryFn: () => api<Page<Product>>('/products?kind=revenda&pageSize=200') });
  const supplyList = [...(supplies.data?.items ?? []), ...(resale.data?.items ?? [])].filter((x) => x.id !== product.id);
  const save = useMutation({ mutationFn: (body: unknown) => api(`/products/${product.id}/options`, { method: 'PUT', json: body }), onSuccess: onDone, onError: setError });
  const setGroup = (gi: number, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const setOption = (gi: number, oi: number, patch: Partial<OptionDraft>) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, options: g.options.map((o, k) => (k === oi ? { ...o, ...patch } : o)) } : g)));
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs text-ink-soft">
        Mínimo 1 e máximo 1 = escolha obrigatória de uma (sabor). Mínimo 0 e máximo 3 = até três adicionais. Preço extra soma no item (membro e não membro pagam igual o adicional). O insumo sai do estoque a cada item vendido com a opção.
      </p>
      {groups.map((g, gi) => (
        <div key={gi} className="space-y-2 rounded-lg bg-white p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs">
              Grupo
              <input className="input" value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} placeholder="Sabor, Cobertura, Adicionais…" />
            </label>
            <label className="w-20 text-xs">
              Mínimo
              <input className="input text-center" inputMode="numeric" value={g.minSelect} onChange={(e) => setGroup(gi, { minSelect: e.target.value })} />
            </label>
            <label className="w-20 text-xs">
              Máximo
              <input className="input text-center" inputMode="numeric" value={g.maxSelect} onChange={(e) => setGroup(gi, { maxSelect: e.target.value })} />
            </label>
            <button className="pb-2 text-xs text-red-600" onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))}>
              Tirar grupo
            </button>
          </div>
          {g.options.map((o, oi) => (
            <div key={oi} className="grid grid-cols-12 items-center gap-2">
              <input className="input col-span-4" value={o.name} onChange={(e) => setOption(gi, oi, { name: e.target.value })} placeholder="Opção (ex.: Morango)" />
              <input className="input col-span-2 text-right" inputMode="decimal" value={o.price} onChange={(e) => setOption(gi, oi, { price: e.target.value })} placeholder="+ R$ 0" />
              <select className="input col-span-3" value={o.supplyId} onChange={(e) => setOption(gi, oi, { supplyId: e.target.value, supplyQty: e.target.value ? o.supplyQty : '' })}>
                <option value="">Sem insumo</option>
                {supplyList.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.unit.toLowerCase()})
                  </option>
                ))}
              </select>
              <input className="input col-span-2 text-right" inputMode="decimal" disabled={!o.supplyId} value={o.supplyQty} onChange={(e) => setOption(gi, oi, { supplyQty: e.target.value })} placeholder="qtd." />
              <button className="col-span-1 text-xs text-red-600" onClick={() => setGroup(gi, { options: g.options.filter((_, k) => k !== oi) })} aria-label="Tirar opção">
                ✕
              </button>
            </div>
          ))}
          <button className="text-sm text-brand" onClick={() => setGroup(gi, { options: [...g.options, { id: null, name: '', price: '', supplyId: '', supplyQty: '' }] })}>
            + opção
          </button>
        </div>
      ))}
      <button className="btn-ghost" onClick={() => setGroups((gs) => [...gs, { id: null, name: gs.length ? 'Adicionais' : 'Sabor', minSelect: gs.length ? '0' : '1', maxSelect: gs.length ? '3' : '1', options: [{ id: null, name: '', price: '', supplyId: '', supplyQty: '' }] }])}>
        + grupo
      </button>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => {
            const body = {
              groups: groups.map((g) => ({
                id: g.id,
                name: g.name,
                minSelect: g.minSelect,
                maxSelect: g.maxSelect,
                options: g.options.filter((o) => o.name.trim()).map((o) => ({ id: o.id, name: o.name, price: o.price || 0, supplyId: o.supplyId || null, supplyQty: o.supplyId ? o.supplyQty : null })),
              })),
            };
            const parsed = optionGroupsSchema.safeParse(body);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(null);
            save.mutate(parsed.data);
          }}
        >
          Salvar montagem
        </button>
      </div>
    </div>
  );
}
