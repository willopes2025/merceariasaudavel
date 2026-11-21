import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  PAYMENT_KINDS,
  changeFor,
  customerSchema,
  formatPhone,
  parseNumber,
  type CashSession,
  type Customer,
  type CustomerOption,
  type Order,
  type PaymentMethod,
  type ProductOption,
  type Sale,
  type SaleQuote,
  type Store,
} from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Drawer, ErrorBox, Field, Loading } from '../../components/ui';
import { OptionPicker } from '../../components/OptionPicker';
import { formatMoney, formatQty } from '../../components/format';

interface Line {
  product: ProductOption;
  quantity: number;
  /** Montagem escolhida (ids) e os nomes para mostrar. */
  options: string[];
  optionNames: string[];
}
interface Payment {
  methodId: string;
  amount: string;
}

const WEIGHT = ['KG', 'G', 'L', 'ML'];
const toNumber = (v: string) => {
  const n = parseNumber(v);
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};
const cents = (v: number) => Math.round(v * 100);

/**
 * Caixa do balcão. O leitor de código de barras digita o código e dá Enter:
 * o produto entra direto. Produto de balança pede o peso. A conta (preço de
 * membro, desconto, cashback) é sempre a do servidor.
 */
export function PdvScreen() {
  const client = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const mine = (stores.data ?? []).filter((s) => s.active && (!session.user()?.storeIds.length || session.user()!.storeIds.includes(s.id)));
  const [storeId, setStoreId] = useState<string>(() => localStorage.getItem('mercearia.pdv.store') ?? '');
  useEffect(() => {
    if (mine.length && !mine.some((s) => s.id === storeId)) setStoreId(mine[0]!.id);
  }, [mine, storeId]);
  useEffect(() => {
    if (storeId) localStorage.setItem('mercearia.pdv.store', storeId);
  }, [storeId]);

  const cashQ = useQuery({ queryKey: ['cash-current', storeId], queryFn: () => api<{ session: CashSession | null }>(`/cash/current?storeId=${storeId}`), enabled: Boolean(storeId) && can('cash.operate') });
  const cash = { data: cashQ.data?.session ?? null, isLoading: cashQ.isLoading };
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethod[]>('/payment-methods') });

  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [discount, setDiscount] = useState('');
  const [useCashback, setUseCashback] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [cpf, setCpf] = useState('');
  const [weighing, setWeighing] = useState<ProductOption | null>(null);
  const [picking, setPicking] = useState<ProductOption | null>(null);
  const [done, setDone] = useState<Sale | null>(null);
  /** Pedido do app/totem sendo cobrado. */
  const [order, setOrder] = useState<Order | null>(null);
  const [showOrders, setShowOrders] = useState(false);
  const pending = useQuery({
    queryKey: ['orders-pending', storeId],
    queryFn: () => api<Order[]>(`/orders/pending?storeId=${storeId}`),
    enabled: Boolean(storeId) && can('sale.create'),
    refetchInterval: 15_000,
  });

  const items = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, options: l.options }));
  const quoteBody = { storeId, customerId: customer?.id ?? null, items, discount: toNumber(discount), useCashback: useCashback ? 1_000_000 : 0 };
  const quote = useQuery({
    queryKey: ['sale-quote', JSON.stringify(quoteBody)],
    queryFn: () => api<SaleQuote>('/sales/quote', { method: 'POST', json: quoteBody }),
    enabled: Boolean(storeId) && lines.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
  });
  // Venda vazia não mostra a conta anterior (a consulta guarda o último resultado).
  const q = lines.length ? quote.data : undefined;
  const total = q?.total ?? 0;
  const [round, setRound] = useState(0);

  const kindOf = (id: string) => methods.data?.find((m) => m.id === id)?.kind ?? 'outro';
  const paid = payments.map((p) => ({ amount: toNumber(p.amount), kind: kindOf(p.methodId) }));
  const check = changeFor(total, paid);
  const remaining = Math.max(0, (cents(total) - paid.reduce((s, p) => s + cents(p.amount), 0)) / 100);

  function add(product: ProductOption, quantity: number, options: string[] = [], optionNames: string[] = []) {
    const key = options.join(',');
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === product.id && !product.soldByWeight && l.options.join(',') === key);
      if (i >= 0) return ls.map((l, n) => (n === i ? { ...l, quantity: l.quantity + quantity } : l));
      return [...ls, { product, quantity, options, optionNames }];
    });
    setPayments([]);
  }
  function pick(p: ProductOption) {
    if (p.optionGroups?.length) return setPicking(p);
    if (p.soldByWeight || WEIGHT.includes(p.unit)) return setWeighing(p);
    add(p, 1);
  }
  /** Puxa o pedido do app/totem para o caixa: itens, montagem e cliente. */
  async function charge(o: Order) {
    reset();
    setOrder(o);
    setShowOrders(false);
    setLines(
      o.items.map((i) => ({
        product: { id: i.productId, name: i.description, kind: i.kind, barcode: null, sku: null, unit: i.unit, soldByWeight: WEIGHT.includes(i.unit), price: 0, memberPrice: null, trackStock: false, stock: null, categoryName: null, optionGroups: [] },
        quantity: i.quantity,
        options: i.options.map((x) => x.id),
        optionNames: i.options.map((x) => x.name),
      })),
    );
    if (o.customerId) {
      try {
        const c = await api<Customer>(`/customers/${o.customerId}`);
        setCustomer({ id: c.id, name: c.name, phone: c.phone, document: c.document, isMember: c.isMember, cashbackBalance: c.cashbackBalance });
      } catch {
        /* sem permissão de ver clientes: o caixa busca na mão */
      }
    }
  }
  function reset() {
    setOrder(null);
    setLines([]);
    setCustomer(null);
    setDiscount('');
    setUseCashback(false);
    setPayments([]);
    setCpf('');
  }

  const finish = useMutation({
    mutationFn: () =>
      api<Sale>('/sales', {
        method: 'POST',
        json: { ...quoteBody, channel: order?.channel === 'app' ? 'app' : 'loja', orderId: order?.id ?? null, payments: payments.filter((p) => toNumber(p.amount) > 0).map((p) => ({ methodId: p.methodId, amount: toNumber(p.amount) })), cpf: cpf || null, emitNfce: true },
      }),
    onSuccess: (sale) => {
      setDone(sale);
      reset();
      setRound((n) => n + 1);
      client.invalidateQueries({ queryKey: ['cash-current'] });
      client.invalidateQueries({ queryKey: ['sales'] });
      client.invalidateQueries({ queryKey: ['pdv-lookup'] });
      client.invalidateQueries({ queryKey: ['orders-pending'] });
    },
  });

  if (stores.isLoading || cash.isLoading) return <Loading />;
  if (!mine.length) return <ErrorBox error="Você não está em nenhuma loja ativa." />;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Caixa</h1>
          {mine.length > 1 && (
            <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
              {mine.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {cash.data && can('sale.create') && (
          <button className={`btn-ghost ${pending.data?.length ? 'border-brand text-brand' : ''}`} onClick={() => setShowOrders(true)}>
            Pedidos para cobrar{pending.data?.length ? ` (${pending.data.length})` : ''}
          </button>
        )}
        {cash.data && (
          <Link to="/caixa" className="text-sm text-ink-soft hover:text-ink">
            Caixa aberto às {new Date(cash.data.openedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · vendas {cash.data.sales.count} · {formatMoney(cash.data.sales.total)}
          </Link>
        )}
      </div>

      {done && <SaleDone sale={done} onClose={() => setDone(null)} />}
      {order && (
        <div className="card mb-4 flex items-center justify-between gap-3 border-brand p-3 text-sm">
          <span>
            Cobrando o <b>pedido nº {order.number}</b> ({order.callName}, pelo {order.channel === 'app' ? 'app' : 'totem'}). Ao finalizar, ele vai para a tela de preparo.
            {order.notes && <span className="ml-2 text-ink-soft">Obs.: {order.notes}</span>}
          </span>
          <button className="text-xs text-ink-soft underline" onClick={reset}>
            Soltar o pedido
          </button>
        </div>
      )}
      {showOrders && <PendingOrders orders={pending.data ?? []} onClose={() => setShowOrders(false)} onCharge={charge} onChanged={() => pending.refetch()} />}

      {!cash.data ? (
        <OpenCash storeId={storeId} onOpened={() => client.invalidateQueries({ queryKey: ['cash-current'] })} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <section className="space-y-4">
            <ProductSearch key={`p${round}`} storeId={storeId} onPick={pick} />
            <div className="card overflow-x-auto">
              {!lines.length ? (
                <p className="py-16 text-center text-sm text-ink-soft">Passe o código de barras ou busque o produto pelo nome.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="w-36 text-center">Qtd.</th>
                      <th className="text-right">Preço</th>
                      <th className="text-right">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const line = q?.items[i];
                      const weight = l.product.soldByWeight || WEIGHT.includes(l.product.unit);
                      return (
                        <tr key={`${l.product.id}-${i}`}>
                          <td>
                            <span className="font-medium">{l.product.name}</span>
                            {l.optionNames.length > 0 && <div className="text-xs text-ink-soft">{l.optionNames.join(', ')}</div>}
                            {line && line.unitPrice < line.listPrice && <span className="badge ml-2 bg-brand-soft text-brand">Preço de membro</span>}
                            {line?.stockWarning && <div className="text-xs text-amber-700">Estoque: {line.stockWarning}</div>}
                          </td>
                          <td className="text-center">
                            {weight ? (
                              <button className="text-sm text-brand underline" onClick={() => setWeighing({ ...l.product, id: l.product.id })}>
                                {formatQty(l.quantity, l.product.unit)}
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <button className="btn-ghost px-2 py-0.5" aria-label="Menos" onClick={() => setLines((ls) => ls.map((x, n) => (n === i ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}>
                                  −
                                </button>
                                <span className="w-8 tabular-nums">{l.quantity}</span>
                                <button className="btn-ghost px-2 py-0.5" aria-label="Mais" onClick={() => setLines((ls) => ls.map((x, n) => (n === i ? { ...x, quantity: x.quantity + 1 } : x)))}>
                                  +
                                </button>
                              </span>
                            )}
                          </td>
                          <td className="text-right tabular-nums">
                            {line && line.unitPrice < line.listPrice && <div className="text-xs text-ink-soft line-through">{formatMoney(line.listPrice)}</div>}
                            {formatMoney(line?.unitPrice ?? l.product.price)}
                          </td>
                          <td className="text-right font-medium tabular-nums">{line ? formatMoney(line.total) : '…'}</td>
                          <td className="text-right">
                            <button className="text-xs text-red-600 hover:underline" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                              Tirar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {quote.error && <ErrorBox error={quote.error} />}
          </section>

          <aside className="space-y-4">
            <CustomerBox key={`c${round}`} customer={customer} onChange={(c) => { setCustomer(c); setUseCashback(false); setPayments([]); }} wouldSave={q?.wouldSaveAsMember ?? 0} />

            <div className="card space-y-2 p-4 text-sm">
              <Row label="Produtos" value={formatMoney(q?.grossTotal ?? 0)} />
              {(q?.memberSavings ?? 0) > 0 && <Row label="Preço de membro" value={`− ${formatMoney(q!.memberSavings)}`} className="text-brand" />}
              {can('sale.discount') && (
                <label className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">Desconto (R$)</span>
                  <input className="input w-28 text-right" inputMode="decimal" value={discount} onChange={(e) => { setDiscount(e.target.value); setPayments([]); }} placeholder="0,00" />
                </label>
              )}
              {(q?.cashbackAvailable ?? 0) > 0 && (
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={useCashback} onChange={(e) => { setUseCashback(e.target.checked); setPayments([]); }} />
                    Usar cashback (até {formatMoney(q!.cashbackAvailable)})
                  </span>
                  {q!.cashbackUsed > 0 && <span className="text-brand">− {formatMoney(q!.cashbackUsed)}</span>}
                </label>
              )}
              <div className="flex items-end justify-between border-t border-slate-200 pt-2">
                <span className="font-medium">Total</span>
                <span className="text-3xl font-bold tabular-nums">{formatMoney(total)}</span>
              </div>
              {(q?.cashbackEarned ?? 0) > 0 && <p className="text-xs text-brand">A cliente ganha {formatMoney(q!.cashbackEarned)} de cashback nesta compra.</p>}
            </div>

            <div className="card space-y-3 p-4">
              <p className="text-sm font-medium">Pagamento</p>
              <div className="flex flex-wrap gap-2">
                {(methods.data ?? []).filter((m) => m.active).map((m) => (
                  <button
                    key={m.id}
                    className="btn-ghost px-3 py-1.5"
                    disabled={!lines.length || remaining <= 0}
                    onClick={() => setPayments((ps) => [...ps, { methodId: m.id, amount: remaining.toFixed(2).replace('.', ',') }])}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              {payments.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-32 text-sm">{methods.data?.find((m) => m.id === p.methodId)?.name ?? PAYMENT_KINDS.outro}</span>
                  <input className="input text-right" inputMode="decimal" value={p.amount} onChange={(e) => setPayments((ps) => ps.map((x, n) => (n === i ? { ...x, amount: e.target.value } : x)))} aria-label="Valor" />
                  <button className="text-xs text-red-600" onClick={() => setPayments((ps) => ps.filter((_, n) => n !== i))}>
                    Tirar
                  </button>
                </div>
              ))}
              {payments.length > 0 && (check.error ? <p className="text-xs text-amber-700">{check.error}</p> : check.change > 0 && <p className="text-lg font-semibold text-brand">Troco: {formatMoney(check.change)}</p>)}
              <Field label="CPF na nota (opcional)">
                <input className="input" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder={customer ? 'Usa o CPF do cadastro' : '000.000.000-00'} />
              </Field>
              <ErrorBox error={finish.error} />
              <button
                className="btn-primary w-full py-3 text-base"
                disabled={!lines.length || !q || quote.isFetching || Boolean(check.error) || (total > 0 && !payments.length) || finish.isPending}
                onClick={() => finish.mutate()}
              >
                {finish.isPending ? 'Finalizando…' : 'Finalizar venda'}
              </button>
              {lines.length > 0 && (
                <button className="w-full text-xs text-ink-soft hover:text-ink" onClick={reset}>
                  Limpar a venda
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {picking && (
        <OptionPicker
          title={picking.name}
          groups={picking.optionGroups}
          basePrice={picking.price}
          memberPrice={customer?.isMember ? picking.memberPrice : null}
          onClose={() => setPicking(null)}
          onConfirm={(picked, qty) => {
            add(picking, qty, picked.ids, picked.names);
            setPicking(null);
          }}
        />
      )}
      {weighing && (
        <WeightDialog
          product={weighing}
          initial={lines.find((l) => l.product.id === weighing.id)?.quantity}
          onClose={() => setWeighing(null)}
          onConfirm={(q) => {
            setLines((ls) => (ls.some((l) => l.product.id === weighing.id) ? ls.map((l) => (l.product.id === weighing.id ? { ...l, quantity: q } : l)) : [...ls, { product: weighing, quantity: q, options: [], optionNames: [] }]));
            setPayments([]);
            setWeighing(null);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex justify-between ${className}`}>
      <span className="text-ink-soft">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Busca do produto. Enter com código exato (leitor) já põe na venda. */
function ProductSearch({ storeId, onPick }: { storeId: string; onPick: (p: ProductOption) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => input.current?.focus(), []);
  const results = useQuery({ queryKey: ['pdv-lookup', storeId, debounced], queryFn: () => api<ProductOption[]>(`/products/lookup?q=${encodeURIComponent(debounced)}&storeId=${storeId}`), enabled: debounced.length >= 2 });
  const pick = (p: ProductOption) => {
    onPick(p);
    setQ('');
    setDebounced('');
    input.current?.focus();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    // O leitor manda o código e Enter antes da busca com atraso terminar: busca na hora.
    const found = await api<ProductOption[]>(`/products/lookup?q=${encodeURIComponent(text)}&storeId=${storeId}`).catch(() => []);
    if (found.length === 1 || (found[0] && (found[0].barcode === text || found[0].sku === text))) pick(found[0]!);
  }
  return (
    <div className="relative">
      <form onSubmit={submit}>
        <input ref={input} className="input py-3 text-base" placeholder="Código de barras ou nome do produto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Produto" />
      </form>
      {debounced.length >= 2 && results.data && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {!results.data.length && <li className="px-3 py-2 text-sm text-ink-soft">Nada encontrado.</li>}
          {results.data.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => pick(p)}>
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-ink-soft">{[p.categoryName, p.barcode].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-right tabular-nums">
                  {formatMoney(p.price)}
                  {p.unit !== 'UN' && <span className="text-xs text-ink-soft">/{p.unit.toLowerCase()}</span>}
                  {p.memberPrice != null && <div className="text-xs text-brand">membro {formatMoney(p.memberPrice)}</div>}
                  {p.stock != null && <div className={`text-xs ${p.stock <= 0 ? 'text-red-600' : 'text-ink-soft'}`}>estoque {formatQty(p.stock)}</div>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WeightDialog({ product, initial, onClose, onConfirm }: { product: ProductOption; initial?: number; onClose: () => void; onConfirm: (q: number) => void }) {
  const [value, setValue] = useState(initial ? String(initial).replace('.', ',') : '');
  const q = toNumber(value);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <form
        className="card w-full max-w-sm space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (q > 0) onConfirm(Math.round(q * 1000) / 1000);
        }}
      >
        <h2 className="text-lg font-semibold">{product.name}</h2>
        <Field label={`Peso / quantidade em ${product.unit.toLowerCase()} (veja na balança)`}>
          <input autoFocus className="input py-3 text-2xl" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,350" />
        </Field>
        {q > 0 && <p className="text-sm">≈ {formatMoney(Math.round(product.price * q * 100) / 100)} {product.memberPrice != null && <span className="text-brand">(membro {formatMoney(Math.round(product.memberPrice * q * 100) / 100)})</span>}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={q <= 0}>
            Confirmar
          </button>
        </div>
      </form>
    </div>
  );
}

/** Cliente da venda: acha pelo celular/CPF/nome ou cadastra membro na hora (nome + celular). */
function CustomerBox({ customer, onChange, wouldSave }: { customer: CustomerOption | null; onChange: (c: CustomerOption | null) => void; wouldSave: number }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ['pdv-customer', debounced], queryFn: () => api<CustomerOption[]>(`/customers/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 3 && !customer });
  const join = useMutation({
    mutationFn: async (c: CustomerOption) => {
      const full = await api<Record<string, unknown>>(`/customers/${c.id}`);
      return api<{ id: string; name: string; phone: string | null; document: string | null; isMember: boolean; cashbackBalance: number }>(`/customers/${c.id}`, { method: 'PUT', json: { ...full, isMember: true } });
    },
    onSuccess: (c) => onChange({ id: c.id, name: c.name, phone: c.phone, document: c.document, isMember: c.isMember, cashbackBalance: c.cashbackBalance }),
  });

  if (customer)
    return (
      <div className="card p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{customer.name}</p>
            <p className="text-xs text-ink-soft">{formatPhone(customer.phone)}</p>
          </div>
          <button className="text-xs text-ink-soft hover:text-ink" onClick={() => onChange(null)}>
            Trocar
          </button>
        </div>
        {customer.isMember ? (
          <p className="mt-2 flex items-center justify-between text-sm">
            <span className="badge bg-brand text-white">Membro do clube</span>
            <span className="text-brand">Cashback {formatMoney(customer.cashbackBalance)}</span>
          </p>
        ) : (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
            {wouldSave > 0 ? <p>Se entrar no clube agora, economiza <strong>{formatMoney(wouldSave)}</strong> nesta compra.</p> : <p>Ainda não é membro do clube.</p>}
            {can('customer.manage') && (
              <button className="btn-primary mt-2 w-full py-1.5" disabled={join.isPending} onClick={() => join.mutate(customer)}>
                Entrar no clube (grátis)
              </button>
            )}
            <ErrorBox error={join.error} />
          </div>
        )}
      </div>
    );

  return (
    <div className="card space-y-2 p-4">
      <p className="text-sm font-medium">Cliente</p>
      {creating ? (
        <QuickMember initialPhone={q} onCancel={() => setCreating(false)} onCreated={(c) => { setCreating(false); onChange(c); }} />
      ) : (
        <>
          <input className="input" placeholder="Celular, CPF, cartão do app ou nome" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cliente" />
          {results.data?.map((c) => (
            <button key={c.id} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => onChange(c)}>
              <span>
                {c.name} <span className="text-xs text-ink-soft">{formatPhone(c.phone)}</span>
              </span>
              {c.isMember && <span className="badge bg-brand-soft text-brand">Membro</span>}
            </button>
          ))}
          {can('customer.manage') && (
            <button className="text-sm text-brand hover:underline" onClick={() => setCreating(true)}>
              + Cadastrar membro do clube
            </button>
          )}
        </>
      )}
    </div>
  );
}

function QuickMember({ initialPhone, onCancel, onCreated }: { initialPhone: string; onCancel: () => void; onCreated: (c: CustomerOption) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(/^\d/.test(initialPhone) ? initialPhone : '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = customerSchema.safeParse({ name, phone, isMember: true });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy(true);
    try {
      const c = await api<{ id: string; name: string; phone: string | null; document: string | null; isMember: boolean; cashbackBalance: number }>('/customers', { method: 'POST', json: { name, phone, isMember: true } });
      onCreated({ id: c.id, name: c.name, phone: c.phone, document: c.document, isMember: c.isMember, cashbackBalance: c.cashbackBalance });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-2" onSubmit={save}>
      <input autoFocus className="input" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Celular com DDD" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>
          Voltar
        </button>
        <button className="btn-primary flex-1" disabled={busy}>
          Cadastrar
        </button>
      </div>
    </form>
  );
}

function OpenCash({ storeId, onOpened }: { storeId: string; onOpened: () => void }) {
  const [amount, setAmount] = useState('');
  const open = useMutation({ mutationFn: () => api('/cash/open', { method: 'POST', json: { storeId, openingAmount: amount || '0' } }), onSuccess: onOpened });
  if (!can('cash.operate')) return <ErrorBox error="O caixa desta loja está fechado." />;
  return (
    <form
      className="card mx-auto max-w-sm space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        open.mutate();
      }}
    >
      <h2 className="text-lg font-semibold">Abrir o caixa</h2>
      <Field label="Troco na gaveta (R$)">
        <input autoFocus className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
      </Field>
      <ErrorBox error={open.error} />
      <button className="btn-primary w-full" disabled={open.isPending}>
        Abrir caixa
      </button>
    </form>
  );
}

function SaleDone({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const nota = useMemo(() => {
    if (!sale.fiscal) return null;
    if (sale.fiscal.status === 'authorized') return { text: `NFC-e nº ${sale.fiscal.number} autorizada`, tone: 'text-brand' };
    if (sale.fiscal.status === 'processing') return { text: 'Nota processando na SEFAZ', tone: 'text-amber-700' };
    return { text: `Nota não saiu: ${sale.fiscal.message ?? ''}`, tone: 'text-red-600' };
  }, [sale]);
  return (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 border-brand bg-brand-soft p-4">
      <div>
        <p className="font-semibold">Venda nº {sale.number} finalizada · {formatMoney(sale.total)}</p>
        <p className="text-sm">
          {sale.change > 0 && <strong className="mr-3">Troco {formatMoney(sale.change)}</strong>}
          {sale.cashbackEarned > 0 && <span className="mr-3">Cashback ganho {formatMoney(sale.cashbackEarned)}</span>}
          {sale.memberSavings > 0 && <span>Economia de membro {formatMoney(sale.memberSavings)}</span>}
        </p>
        {nota && <p className={`text-sm ${nota.tone}`}>{nota.text}</p>}
        {sale.order && <p className="text-sm font-medium">Pedido nº {sale.order.number} foi para a tela de preparo.</p>}
      </div>
      <div className="flex gap-2">
        {sale.fiscal?.danfeUrl && (
          <a className="btn-ghost" href={sale.fiscal.danfeUrl} target="_blank" rel="noreferrer">
            Imprimir cupom
          </a>
        )}
        <Link to={`/vendas/${sale.id}`} className="btn-ghost">
          Ver venda
        </Link>
        <button className="btn-primary" onClick={onClose}>
          Nova venda
        </button>
      </div>
    </div>
  );
}

/** Pedidos do app e do totem esperando a cliente pagar no caixa. */
function PendingOrders({ orders, onClose, onCharge, onChanged }: { orders: Order[]; onClose: () => void; onCharge: (o: Order) => void; onChanged: () => void }) {
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/orders/${id}/cancel`, { method: 'POST', json: { reason } }),
    onSuccess: onChanged,
  });
  return (
    <Drawer title="Pedidos para cobrar" onClose={onClose}>
      {!orders.length ? (
        <p className="py-10 text-center text-sm text-ink-soft">Nenhum pedido do app ou do totem esperando pagamento.</p>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => (
            <li key={o.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    Nº {o.number} · {o.callName}
                    <span className="badge ml-2 bg-slate-100 text-ink-soft">{o.channel === 'app' ? 'App' : 'Totem'}</span>
                    {o.customerId && <span className="badge ml-1 bg-brand-soft text-brand">Membro</span>}
                  </p>
                  <p className="text-xs text-ink-soft">Pedido às {new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · estimado {formatMoney(o.estimate)}</p>
                </div>
                <button className="btn-primary px-3 py-1.5" onClick={() => onCharge(o)}>
                  Cobrar
                </button>
              </div>
              <ul className="mt-2 text-sm">
                {o.items.map((i, n) => (
                  <li key={n}>
                    {i.unit === 'UN' ? i.quantity : formatQty(i.quantity, i.unit)} × {i.description}
                    {i.options.length > 0 && <span className="text-ink-soft"> ({i.options.map((x) => x.name).join(', ')})</span>}
                  </li>
                ))}
              </ul>
              {o.notes && <p className="mt-1 text-xs text-ink-soft">Obs.: {o.notes}</p>}
              <button
                className="mt-2 text-xs text-red-600 hover:underline"
                disabled={cancel.isPending}
                onClick={() => {
                  const reason = window.prompt(`Cancelar o pedido nº ${o.number}? Diga o motivo:`, 'Não veio pagar');
                  if (reason && reason.trim().length >= 3) cancel.mutate({ id: o.id, reason: reason.trim() });
                }}
              >
                Cancelar pedido
              </button>
            </li>
          ))}
        </ul>
      )}
      {cancel.error && <ErrorBox error={cancel.error} />}
    </Drawer>
  );
}
