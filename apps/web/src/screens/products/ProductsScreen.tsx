import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  PRODUCT_KINDS,
  STOCK_MOVEMENT_TYPES,
  TRACKS_STOCK_BY_DEFAULT,
  formatMoney,
  productSchema,
  stockMoveSchema,
  stockStores,
  type Page,
  type Product,
  type ProductDetail,
  type ProductKind,
  type Store,
} from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../components/os';
import { ProductImportDrawer } from './ProductImportDrawer';
import { StockEntryDrawer } from './StockEntryDrawer';

type MoveType = 'entrada' | 'saida' | 'ajuste' | 'transferencia';

/** Produtos e posição de estoque por loja. `stockView` abre já no que está em falta. */
export function ProductsScreen({ stockView = false }: { stockView?: boolean }) {
  const client = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kind, setKind] = useState('');
  const [stock, setStock] = useState<'all' | 'out'>('all');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, kind, stock, status]);
  const params = new URLSearchParams({ status, stock, page: String(page), pageSize: '30' });
  if (debounced) params.set('q', debounced);
  if (kind) params.set('kind', kind);
  const list = useQuery({ queryKey: ['products', params.toString()], queryFn: () => api<Page<Product>>(`/products?${params}`) });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const activeStores = stockStores((stores.data ?? []).filter((s) => s.active));
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['products'] });
    client.invalidateQueries({ queryKey: ['product'] });
    client.invalidateQueries({ queryKey: ['product-lookup'] });
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={stockView ? 'Estoque' : 'Produtos'}
        subtitle={stockView ? 'Posição por loja. Clique no produto para dar entrada, saída, acerto ou transferir.' : 'Armações, lentes, acessórios e serviços. A armação sai do estoque quando a O.S. é aberta.'}
        action={
          can('stock.adjust') && (
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setEntering(true)}>
                Entrada por XML
              </button>
              <button className="btn-ghost" onClick={() => setImporting(true)}>
                Importar planilha
              </button>
              <button className="btn-primary" onClick={() => setEditing('new')}>
                Novo produto
              </button>
            </div>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Nome, grife ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
        <select className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(PRODUCT_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={stock} onChange={(e) => setStock(e.target.value as 'all' | 'out')} aria-label="Estoque">
          <option value="all">Qualquer estoque</option>
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
          <Empty>{debounced || kind || stock === 'out' ? 'Nenhum produto com esses filtros.' : 'Nenhum produto cadastrado ainda.'}</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Tipo</th>
                <th className="text-right">Preço</th>
                {activeStores.map((s) => (
                  <th key={s.id} className="text-right">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(p.id)}>
                  <td>
                    <span className="font-medium">{p.name}</span>
                    {!p.active && <span className="badge ml-2 bg-slate-100 text-slate-500">Desativado</span>}
                    <div className="text-xs text-ink-soft">{[p.brand, p.sku].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>{PRODUCT_KINDS[p.kind]}</td>
                  <td className="text-right tabular-nums">{formatMoney(p.price)}</td>
                  {activeStores.map((s) => {
                    const n = p.stock.find((b) => b.storeId === s.id)?.quantity;
                    return (
                      <td key={s.id} className={`text-right tabular-nums ${n !== undefined && n <= 0 ? 'font-medium text-red-600' : ''}`}>
                        {n === undefined ? '—' : n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
            Anterior
          </button>
          <span className="text-ink-soft">
            Página {page} de {pages} · {list.data?.total} produtos
          </span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>
            Próxima
          </button>
        </div>
      )}
      {editing && <ProductForm product={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={(p) => { refresh(); setEditing(null); setViewing(p.id); }} />}
      {entering && <StockEntryDrawer onClose={() => setEntering(false)} onDone={refresh} />}
      {importing && <ProductImportDrawer onClose={() => setImporting(false)} onImported={refresh} />}
      {viewing && !editing && <ProductDrawer id={viewing} stores={activeStores} onClose={() => setViewing(null)} onEdit={setEditing} onChanged={refresh} />}
    </div>
  );
}

function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: (p: Product) => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [kind, setKind] = useState<ProductKind>(product?.kind ?? 'armacao');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [price, setPrice] = useState(product ? product.price.toFixed(2).replace('.', ',') : '');
  const [cost, setCost] = useState(product?.cost ? product.cost.toFixed(2).replace('.', ',') : '');
  const [ncm, setNcm] = useState(product?.ncm ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [trackStock, setTrack] = useState(product?.trackStock ?? true);
  const [active, setActive] = useState(product?.active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = productSchema.safeParse({ name, kind, brand: brand || null, sku: sku || null, price, cost, trackStock, active, ncm, unit });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    setBusy(true);
    try {
      onSaved(await api<Product>(product ? `/products/${product.id}` : '/products', { method: product ? 'PUT' : 'POST', json: parsed.data }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <Drawer title={product ? 'Editar produto' : 'Novo produto'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Ex.: RB5154 Clubmaster preto 51" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <select
              className="input"
              value={kind}
              onChange={(e) => {
                const k = e.target.value as ProductKind;
                setKind(k);
                if (!product) setTrack(TRACKS_STOCK_BY_DEFAULT[k]);
              }}
            >
              {Object.entries(PRODUCT_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grife">
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
        </div>
        <Field label="Código" hint="Código interno ou de barras. Não pode repetir.">
          <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço de venda (R$)">
            <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Custo (R$)">
            <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NCM" hint="8 números. Vai na nota fiscal.">
            <input className="input tabular-nums" inputMode="numeric" value={ncm} onChange={(e) => setNcm(e.target.value)} />
          </Field>
          <Field label="Unidade" hint="Ex.: UN, PAR">
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={trackStock} onChange={(e) => setTrack(e.target.checked)} />
          <span>
            Controla estoque
            <span className="block text-xs text-ink-soft">Desmarque para lente sob encomenda e serviços.</span>
          </span>
        </label>
        {product && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Produto ativo
          </label>
        )}
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Drawer>
  );
}

function ProductDrawer({ id, stores, onClose, onEdit, onChanged }: { id: string; stores: Store[]; onClose: () => void; onEdit: (p: Product) => void; onChanged: () => void }) {
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<ProductDetail>(`/products/${id}`) });
  const [moving, setMoving] = useState<MoveType | null>(null);
  const p = q.data;
  return (
    <Drawer title={p?.name ?? 'Produto'} onClose={onClose} wide>
      {!p ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-soft">
              {PRODUCT_KINDS[p.kind]}
              {p.brand && ` · ${p.brand}`}
              {p.sku && ` · ${p.sku}`} · {formatMoney(p.price)}
              {can('finance.view') && p.cost > 0 && ` · custo ${formatMoney(p.cost)}`}
            </span>
            {can('stock.adjust') && (
              <button className="text-brand" onClick={() => onEdit(p)}>
                Editar cadastro
              </button>
            )}
          </div>
          {!p.trackStock ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-ink-soft">Este produto não controla estoque.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {p.stock.map((s) => (
                  <div key={s.storeId} className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs text-ink-soft">{s.storeName}</div>
                    <div className={`text-lg font-semibold tabular-nums ${s.quantity <= 0 ? 'text-red-600' : ''}`}>{s.quantity}</div>
                  </div>
                ))}
              </div>
              {can('stock.adjust') && !moving && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={() => setMoving('entrada')}>
                    Entrada
                  </button>
                  <button className="btn-ghost" onClick={() => setMoving('saida')}>
                    Saída
                  </button>
                  <button className="btn-ghost" onClick={() => setMoving('ajuste')}>
                    Acerto (contagem)
                  </button>
                  {stores.length > 1 && (
                    <button className="btn-ghost" onClick={() => setMoving('transferencia')}>
                      Transferir
                    </button>
                  )}
                </div>
              )}
              {moving && <MoveForm product={p} type={moving} stores={stores} onCancel={() => setMoving(null)} onDone={() => { setMoving(null); q.refetch(); onChanged(); }} />}
              <div>
                <h3 className="mb-2 text-sm font-semibold">Movimentações</h3>
                {!p.movements.length ? (
                  <p className="text-sm text-ink-soft">Nenhuma movimentação ainda.</p>
                ) : (
                  <table className="table tabular-nums">
                    <thead>
                      <tr>
                        <th>Quando</th>
                        <th>O quê</th>
                        <th>Loja</th>
                        <th className="text-right">Qtd.</th>
                        <th className="text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.movements.map((m) => (
                        <tr key={m.id}>
                          <td>{formatDateTime(m.at)}</td>
                          <td>
                            {m.orderId ? (
                              <Link className="text-brand" to={`/os/${m.orderId}`}>
                                {STOCK_MOVEMENT_TYPES[m.type]} {m.orderNumber}
                              </Link>
                            ) : (
                              STOCK_MOVEMENT_TYPES[m.type]
                            )}
                            <div className="text-xs text-ink-soft">{[!m.orderId && m.note, m.userName].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td>{m.storeName}</td>
                          <td className={`text-right ${m.delta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                          <td className="text-right">{m.balanceAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

const MOVE_TITLES: Record<MoveType, string> = { entrada: 'Entrada de estoque', saida: 'Saída de estoque', ajuste: 'Acerto por contagem', transferencia: 'Transferir entre lojas' };

function MoveForm({ product, type, stores, onCancel, onDone }: { product: ProductDetail; type: MoveType; stores: Store[]; onCancel: () => void; onDone: () => void }) {
  const user = session.user();
  const allowed = stores;
  const [storeId, setStoreId] = useState(allowed[0]?.id ?? '');
  const [toStoreId, setTo] = useState(stores.find((s) => s.id !== allowed[0]?.id)?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (data: unknown) => api(`/products/${product.id}/stock`, { method: 'POST', json: data }), onSuccess: onDone, onError: setError });
  const here = product.stock.find((s) => s.storeId === storeId)?.quantity ?? 0;
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = stockMoveSchema.safeParse({ type, storeId, toStoreId, quantity, note: note || (type === 'saida' ? '' : null) });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    save.mutate(parsed.data);
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold">{MOVE_TITLES[type]}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={type === 'transferencia' ? 'Da loja' : 'Loja'}>
          <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {allowed.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {type === 'transferencia' && (
          <Field label="Para a loja">
            <select className="input" value={toStoreId} onChange={(e) => setTo(e.target.value)}>
              {stores.filter((s) => s.id !== storeId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={type === 'ajuste' ? 'Quantos tem de verdade na prateleira' : 'Quantidade'} hint={`O sistema está com ${here} nesta loja.`}>
          <input className="input tabular-nums" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))} autoFocus />
        </Field>
      </div>
      <Field label={type === 'saida' ? 'Motivo' : 'Observação (opcional)'}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'entrada' ? 'Ex.: NF 1234 do fornecedor' : type === 'saida' ? 'Ex.: peça com defeito' : ''} />
      </Field>
      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn-primary" disabled={save.isPending || quantity === ''}>
          Confirmar
        </button>
      </div>
    </form>
  );
}
