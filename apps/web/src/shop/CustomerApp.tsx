import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  CUSTOMER_GOALS,
  formatMoney,
  formatPhone,
  type CustomerGoal,
  type Order,
  ORDER_STATUS,
  type ShopCashbackEntry,
  type ShopCatalog,
  type ShopInfo,
  type ShopLoginResult,
  type ShopMe,
  type ShopProduct,
  type ShopPurchase,
} from '@mercearia/contracts';
import { OptionPicker } from '../components/OptionPicker';
import { useCart, type CartLine } from './cart';
import { ApiError } from '../lib/api';
import { customerSession, shopApi, whenCustomerSessionExpires } from './api';
import { Catalog, Leaf, ProductCard, Qr, Spinner, saving } from './parts';

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => !(e instanceof ApiError && [401, 404].includes(e.status)) && n < 2 },
  },
});

/**
 * App do cliente (/app). Ser membro = ter o app: cadastro com nome, celular e
 * PIN; depois disso o cartão de membro (QR) fica na tela inicial para mostrar
 * no caixa. Instalável no celular (PWA); a versão das lojas (Play Store /
 * App Store) embrulha esta mesma página.
 */
export function CustomerApp() {
  const [token, setToken] = useState(() => customerSession.token());
  whenCustomerSessionExpires(() => {
    client.clear();
    setToken(null);
  });
  useEffect(() => {
    document.title = 'Mercearia Saudável — Clube';
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app-sw.js', { scope: '/app' }).catch(() => undefined);
  }, []);

  const signedIn = (r: ShopLoginResult) => {
    customerSession.save(r.token);
    client.clear();
    setToken(r.token);
  };
  const signOut = () => {
    customerSession.clear();
    client.clear();
    setToken(null);
  };

  return (
    <QueryClientProvider client={client}>
      <div className="min-h-full bg-[#F6F8F4]">{token ? <SignedIn onSignOut={signOut} onToken={signedIn} /> : <Welcome onSignedIn={signedIn} />}</div>
    </QueryClientProvider>
  );
}

const useInfo = () => useQuery({ queryKey: ['shop', 'info'], queryFn: () => shopApi<ShopInfo>(''), staleTime: 5 * 60_000 });
const useCatalog = () => useQuery({ queryKey: ['shop', 'catalog'], queryFn: () => shopApi<ShopCatalog>('/catalog'), staleTime: 60_000 });
const useMe = () => useQuery({ queryKey: ['shop', 'me'], queryFn: () => shopApi<ShopMe>('/me') });

// ------------------------------------------------------------------ entrada

function Welcome({ onSignedIn }: { onSignedIn: (r: ShopLoginResult) => void }) {
  const [mode, setMode] = useState<'cadastro' | 'entrar'>('cadastro');
  const info = useInfo();
  const club = info.data?.club;
  return (
    <div className="mx-auto max-w-md px-5 pb-10">
      <header className="flex items-center gap-2 pt-6">
        <Leaf className="h-8 w-8" />
        <span className="text-lg font-bold text-brand-dark">Mercearia Saudável</span>
      </header>
      <section className="mt-6 rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-6 text-white shadow-lg">
        <p className="text-sm font-medium text-brand-accent">Clube Mercearia · grátis</p>
        <h1 className="mt-1 text-2xl font-bold leading-tight">Membro paga menos em toda compra.</h1>
        <ul className="mt-4 space-y-2 text-sm text-white/90">
          <li>✓ Preço de membro em suplementos, Pacco, shakes e mais</li>
          {club && club.cashbackPct > 0 && (
            <li>
              ✓ {club.cashbackPct.toLocaleString('pt-BR')}% de volta em cashback
              {club.cashbackDays > 0 ? ` (vale ${club.cashbackDays} dias)` : ''}
            </li>
          )}
          <li>✓ Seu cartão de membro no celular: é só mostrar no caixa</li>
        </ul>
      </section>
      <div className="mt-6 grid grid-cols-2 rounded-xl bg-white p-1 shadow-sm">
        {(['cadastro', 'entrar'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-lg py-2.5 text-sm font-semibold ${mode === m ? 'bg-brand text-white' : 'text-ink-soft'}`}>
            {m === 'cadastro' ? 'Quero ser membro' : 'Já sou membro'}
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">{mode === 'cadastro' ? <SignupForm onDone={onSignedIn} club={club} /> : <LoginForm onDone={onSignedIn} />}</div>
      <p className="mt-6 text-center text-sm">
        <a href="/cardapio" className="font-medium text-brand underline">
          Ver produtos e preços
        </a>
      </p>
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const { label, hint, ...rest } = props;
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input {...rest} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand" />
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

const pinProps = { inputMode: 'numeric' as const, pattern: '\\d{6}', maxLength: 6, autoComplete: 'off' };
const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error instanceof Error ? error.message : 'Algo deu errado.'}</p>;
}

function SignupForm({ onDone, club }: { onDone: (r: ShopLoginResult) => void; club?: ShopInfo['club'] }) {
  const [f, setF] = useState({ name: '', phone: '', document: '', pin: '', pin2: '', goal: '' as CustomerGoal | '', allowWhatsapp: true, acceptTerms: false });
  const [local, setLocal] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      shopApi<ShopLoginResult>('/signup', {
        method: 'POST',
        json: { name: f.name, phone: f.phone, document: f.document || null, pin: f.pin, goal: f.goal || null, allowWhatsapp: f.allowWhatsapp, acceptTerms: f.acceptTerms },
      }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocal(null);
    if (f.pin !== f.pin2) return setLocal('Os dois PINs não estão iguais.');
    if (!f.acceptTerms) return setLocal('Aceite as regras do clube para continuar.');
    m.mutate();
  };
  const needsCpf = m.error instanceof ApiError && m.error.code === 'CONFIRM_AT_STORE';
  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Seu nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required />
      <Input label="Celular com DDD" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="(27) 99999-9999" required />
      <Input
        label="CPF (opcional)"
        value={f.document}
        onChange={(e) => setF({ ...f, document: e.target.value })}
        inputMode="numeric"
        hint={needsCpf ? 'Já compra com a gente? Use o mesmo CPF do seu cadastro na loja.' : 'Para a nota fiscal sair no seu nome.'}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Crie um PIN" type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: onlyDigits(e.target.value) })} {...pinProps} required />
        <Input label="Repita o PIN" type="password" value={f.pin2} onChange={(e) => setF({ ...f, pin2: onlyDigits(e.target.value) })} {...pinProps} required />
      </div>
      <p className="-mt-2 text-xs text-ink-soft">6 números. Você usa o PIN para entrar no app.</p>
      <label className="block">
        <span className="text-sm font-medium text-ink">Seu objetivo (opcional)</span>
        <select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value as CustomerGoal | '' })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base">
          <option value="">Escolher depois</option>
          {Object.entries(CUSTOMER_GOALS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={f.allowWhatsapp} onChange={(e) => setF({ ...f, allowWhatsapp: e.target.checked })} />
        Quero receber ofertas de membro pelo WhatsApp.
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={f.acceptTerms} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} />
        <span>
          Aceito as regras do clube: preço de membro com o cartão do app
          {club && club.cashbackPct > 0 ? `, ${club.cashbackPct.toLocaleString('pt-BR')}% de cashback` : ''}
          {club && club.cashbackDays > 0 ? ` válido por ${club.cashbackDays} dias` : ''}
          {club && club.cashbackMaxUsePct < 100 ? `, usando até ${club.cashbackMaxUsePct.toLocaleString('pt-BR')}% de cada compra` : ''}.
        </span>
      </label>
      {local ? <ErrorLine error={new Error(local)} /> : <ErrorLine error={m.error} />}
      <button disabled={m.isPending} className="w-full rounded-xl bg-brand py-3.5 text-base font-semibold text-white disabled:opacity-60">
        {m.isPending ? 'Criando…' : 'Virar membro grátis'}
      </button>
    </form>
  );
}

function LoginForm({ onDone }: { onDone: (r: ShopLoginResult) => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const m = useMutation({ mutationFn: () => shopApi<ShopLoginResult>('/login', { method: 'POST', json: { phone, pin } }), onSuccess: onDone });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="space-y-4"
    >
      <Input label="Celular com DDD" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required />
      <Input label="PIN (6 números)" type="password" value={pin} onChange={(e) => setPin(onlyDigits(e.target.value))} {...pinProps} required hint="Esqueceu ou é seu primeiro acesso de um cadastro feito na loja? Peça um código no caixa." />
      <ErrorLine error={m.error} />
      <button disabled={m.isPending} className="w-full rounded-xl bg-brand py-3.5 text-base font-semibold text-white disabled:opacity-60">
        {m.isPending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ logado

function SignedIn({ onSignOut, onToken }: { onSignOut: () => void; onToken: (r: ShopLoginResult) => void }) {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (me.error || !me.data)
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <ErrorLine error={me.error} />
        <button className="mt-4 text-brand underline" onClick={() => me.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  if (me.data.mustChangePin) return <CreatePin me={me.data} onToken={onToken} />;
  return <Shell me={me.data} onSignOut={onSignOut} onToken={onToken} />;
}

type Cart = ReturnType<typeof useCart>;

function Shell({ me, onSignOut, onToken }: { me: ShopMe; onSignOut: () => void; onToken: (r: ShopLoginResult) => void }) {
  const cart = useCart(`mercearia.carrinho.${me.id}`);
  const info = useInfo();
  const ordering = info.data?.ordersEnabled ?? false;
  const [picking, setPicking] = useState<ShopProduct | null>(null);
  const onAdd = ordering ? (p: ShopProduct) => (p.optionGroups.length ? setPicking(p) : cart.add(p)) : undefined;
  return (
    <BrowserRouter>
      <div className="mx-auto min-h-screen max-w-md pb-24">
        <header className="flex items-center gap-2 px-5 pb-2 pt-5">
          <Leaf className="h-7 w-7" />
          <span className="font-bold text-brand-dark">Mercearia Saudável</span>
        </header>
        <main className="px-4">
          <Routes>
            <Route path="/app" element={<Home me={me} onAdd={onAdd} />} />
            <Route path="/app/produtos" element={<Products onAdd={onAdd} />} />
            <Route path="/app/extrato" element={<Statement />} />
            <Route path="/app/conta" element={<Account me={me} onSignOut={onSignOut} onToken={onToken} />} />
            <Route path="/app/pedido/:id" element={<OrderTrack me={me} />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </main>
        {ordering && <CartBar cart={cart} />}
        <BottomNav />
        {picking && (
          <OptionPicker
            title={picking.name}
            groups={picking.optionGroups}
            basePrice={picking.price}
            memberPrice={picking.memberPrice}
            onClose={() => setPicking(null)}
            onConfirm={(picked, qty) => {
              cart.add(picking, qty, picked);
              setPicking(null);
            }}
          />
        )}
      </div>
    </BrowserRouter>
  );
}

// ------------------------------------------------------------------ pedido

function CartBar({ cart }: { cart: Cart }) {
  const [open, setOpen] = useState(false);
  if (!cart.count) return null;
  return (
    <>
      <div className="fixed inset-x-0 bottom-[64px] z-20 px-4" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <button onClick={() => setOpen(true)} className="mx-auto flex w-full max-w-md items-center justify-between rounded-2xl bg-brand-dark px-5 py-3.5 text-white shadow-lg">
          <span className="font-semibold">
            Ver pedido · {cart.count} ite{cart.count === 1 ? 'm' : 'ns'}
          </span>
          <span className="font-bold">{formatMoney(cart.total(true))}</span>
        </button>
      </div>
      {open && <CartSheet cart={cart} onClose={() => setOpen(false)} />}
    </>
  );
}

function CartLines({ cart, member }: { cart: Cart; member: boolean }) {
  return (
    <ul className="divide-y divide-slate-100">
      {cart.lines.map((l: CartLine) => (
        <li key={l.key} className="flex items-center gap-3 py-3">
          <div className="flex-1">
            <p className="font-medium text-ink">{l.product.name}</p>
            {l.optionNames.length > 0 && <p className="text-xs text-ink-soft">{l.optionNames.join(', ')}</p>}
            <p className="text-sm text-brand">{formatMoney(((member ? l.product.memberPrice : l.product.price) + l.extras) * l.quantity)}</p>
          </div>
          <div className="flex items-center rounded-xl border border-slate-300">
            <button className="px-3 py-1.5 text-lg" onClick={() => cart.setQty(l.key, l.quantity - 1)} aria-label="Menos">
              −
            </button>
            <span className="w-6 text-center tabular-nums">{l.quantity}</span>
            <button className="px-3 py-1.5 text-lg" onClick={() => cart.setQty(l.key, l.quantity + 1)} aria-label="Mais">
              +
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CartSheet({ cart, onClose }: { cart: Cart; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: () => shopApi<Order>('/me/orders', { method: 'POST', json: { items: cart.items, notes: notes || null } }),
    onSuccess: (o) => {
      cart.clear();
      qc.invalidateQueries({ queryKey: ['shop', 'orders'] });
      onClose();
      navigate(`/app/pedido/${o.id}`);
    },
  });
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Seu pedido">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Seu pedido</h2>
          <button onClick={onClose} aria-label="Fechar" className="px-2 text-2xl leading-none text-ink-soft">
            ×
          </button>
        </div>
        <CartLines cart={cart} member />
        <label className="mt-2 block">
          <span className="text-sm font-medium text-ink">Observação (opcional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Ex.: sem gelo, bem batido" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-brand" />
        </label>
        <div className="mt-4 flex items-end justify-between">
          <span className="text-sm text-ink-soft">Total com preço de membro</span>
          <span className="text-2xl font-bold text-ink">{formatMoney(cart.total(true))}</span>
        </div>
        <p className="mt-1 text-xs text-ink-soft">Você paga no caixa (Pix, cartão ou dinheiro) e o preparo começa na hora. Cashback pode ser usado no pagamento.</p>
        <ErrorLine error={m.error} />
        <button disabled={m.isPending} onClick={() => m.mutate()} className="mt-3 w-full rounded-xl bg-brand py-3.5 text-base font-semibold text-white disabled:opacity-60">
          {m.isPending ? 'Enviando…' : 'Fazer pedido · pagar no caixa'}
        </button>
        <button onClick={cart.clear} className="mt-2 w-full py-2 text-sm text-ink-soft">
          Esvaziar
        </button>
      </div>
    </div>
  );
}

const STEPS: Array<Order['status']> = ['aguardando_pagamento', 'na_fila', 'preparando', 'pronto', 'entregue'];
const STEP_LABEL: Record<string, string> = { aguardando_pagamento: 'Pagar', na_fila: 'Na fila', preparando: 'Preparo', pronto: 'Pronto', entregue: 'Entregue' };

function OrderTrack({ me }: { me: ShopMe }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ['shop', 'order', id],
    queryFn: () => shopApi<Order>(`/me/orders/${id}`),
    refetchInterval: (q) => (q.state.data && ['entregue', 'cancelado'].includes(q.state.data.status) ? false : 5_000),
  });
  const cancel = useMutation({
    mutationFn: () => shopApi<Order>(`/me/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (o) => {
      qc.setQueryData(['shop', 'order', id], o);
      qc.invalidateQueries({ queryKey: ['shop', 'orders'] });
    },
  });
  if (order.isLoading) return <Spinner />;
  const o = order.data;
  if (!o) return <ErrorLine error={order.error} />;
  const step = STEPS.indexOf(o.status);
  return (
    <div className="space-y-4">
      <section className={`rounded-3xl p-6 text-center shadow-lg ${o.status === 'pronto' ? 'bg-brand-accent text-brand-dark' : o.status === 'cancelado' ? 'bg-slate-200 text-ink' : 'bg-gradient-to-br from-brand to-brand-dark text-white'}`}>
        <p className="text-sm font-semibold uppercase tracking-wider opacity-80">Pedido</p>
        <p className="text-7xl font-bold tabular-nums">{o.number}</p>
        <p className="mt-2 text-xl font-bold">{ORDER_STATUS[o.status]}</p>
        {o.status === 'aguardando_pagamento' && <p className="mt-1 text-sm opacity-90">Vá ao caixa e mostre seu cartão ({me.memberCode}) ou diga o número do pedido.</p>}
        {o.status === 'pronto' && <p className="mt-1 text-sm font-medium">Pode retirar no balcão!</p>}
        {o.status === 'cancelado' && o.cancelReason && <p className="mt-1 text-sm">{o.cancelReason}</p>}
      </section>
      {o.status !== 'cancelado' && (
        <ol className="flex justify-between rounded-2xl bg-white p-4 text-center text-[11px] shadow-sm">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex-1 ${i <= step ? 'font-semibold text-brand' : 'text-ink-soft'}`}>
              <span className={`mx-auto mb-1 block h-2.5 w-2.5 rounded-full ${i <= step ? 'bg-brand' : 'bg-slate-300'}`} />
              {STEP_LABEL[s]}
            </li>
          ))}
        </ol>
      )}
      <section className="rounded-2xl bg-white p-4 text-sm shadow-sm">
        {o.items.map((i, n) => (
          <p key={n} className="py-0.5">
            <b>{i.quantity.toLocaleString('pt-BR')}×</b> {i.description}
            {i.options.length > 0 && <span className="text-ink-soft"> ({i.options.map((x) => x.name).join(', ')})</span>}
          </p>
        ))}
        {o.notes && <p className="mt-1 text-ink-soft">Obs.: {o.notes}</p>}
        <p className="mt-2 border-t border-slate-100 pt-2 font-semibold">
          {o.saleId ? 'Pago' : 'Estimado'}: {formatMoney(o.estimate)}
        </p>
      </section>
      {o.status === 'aguardando_pagamento' && (
        <button disabled={cancel.isPending} onClick={() => cancel.mutate()} className="w-full rounded-xl border border-slate-300 bg-white py-3 font-semibold text-ink">
          Cancelar pedido
        </button>
      )}
      <ErrorLine error={cancel.error} />
      <NavLink to="/app" className="block text-center text-sm font-medium text-brand">
        Voltar ao início
      </NavLink>
    </div>
  );
}

const useOrders = () => useQuery({ queryKey: ['shop', 'orders'], queryFn: () => shopApi<Order[]>('/me/orders'), refetchInterval: 15_000 });

function ActiveOrders() {
  const orders = useOrders();
  const active = (orders.data ?? []).filter((o) => !['entregue', 'cancelado'].includes(o.status)).slice(0, 2);
  if (!active.length) return null;
  return (
    <div className="space-y-2">
      {active.map((o) => (
        <NavLink key={o.id} to={`/app/pedido/${o.id}`} className={`flex items-center justify-between rounded-2xl px-4 py-3 shadow-sm ${o.status === 'pronto' ? 'bg-brand-accent text-brand-dark' : 'bg-white'}`}>
          <span>
            <span className="text-2xl font-bold tabular-nums">{o.number}</span>
            <span className="ml-3 text-sm font-semibold">{ORDER_STATUS[o.status]}</span>
          </span>
          <span className="text-sm text-brand">Acompanhar ›</span>
        </NavLink>
      ))}
    </div>
  );
}

function OrdersHistory() {
  const orders = useOrders();
  if (orders.isLoading) return <Spinner />;
  if (!orders.data?.length) return <Empty>Seus pedidos pelo app aparecem aqui.</Empty>;
  return (
    <ul className="space-y-2">
      {orders.data.map((o) => (
        <li key={o.id}>
          <NavLink to={`/app/pedido/${o.id}`} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-ink">
                Nº {o.number} · {ORDER_STATUS[o.status]}
              </p>
              <p className="text-xs text-ink-soft">
                {new Date(o.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {o.items.map((i) => i.description).join(', ')}
              </p>
            </div>
            <span className="text-sm font-bold text-ink">{formatMoney(o.estimate)}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function BottomNav() {
  const items: Array<[string, string, ReactNode]> = [
    ['/app', 'Início', <path key="i" d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />],
    ['/app/produtos', 'Produtos', <path key="p" d="M4 7h16l-1.5 12.5a1 1 0 0 1-1 .5h-11a1 1 0 0 1-1-.5zM9 7a3 3 0 0 1 6 0" />],
    ['/app/extrato', 'Extrato', <path key="e" d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />],
    ['/app/conta', 'Conta', <path key="c" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0" />],
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto grid max-w-md grid-cols-4">
        {items.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${isActive ? 'text-brand' : 'text-ink-soft'}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
              {icon}
            </svg>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function MemberCard({ me }: { me: ShopMe }) {
  return (
    <section className="rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-accent">Cartão de membro</p>
          <p className="mt-1 text-lg font-bold leading-tight">{me.name}</p>
          {me.memberSince && <p className="text-xs text-white/70">Membro desde {new Date(me.memberSince).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>}
        </div>
        <Leaf className="h-8 w-8" />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <div className="rounded-2xl bg-white p-2">
          <Qr value={me.memberCode} size={128} />
        </div>
        <div>
          <p className="text-xs text-white/70">Mostre no caixa ou fale o código</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.2em]">{me.memberCode}</p>
          <p className="mt-1 text-xs text-white/70">ou o seu celular {formatPhone(me.phone)}</p>
        </div>
      </div>
    </section>
  );
}

function Home({ me, onAdd }: { me: ShopMe; onAdd?: (p: ShopProduct) => void }) {
  const catalog = useCatalog();
  const offers = (catalog.data?.products ?? [])
    .filter((p) => p.available && saving(p) > 0)
    .sort((a, b) => saving(b) / b.price - saving(a) / a.price)
    .slice(0, 6);
  return (
    <div className="space-y-4">
      <ActiveOrders />
      <MemberCard me={me} />
      <InstallHint />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-ink-soft">Seu cashback</p>
          <p className="mt-1 text-2xl font-bold text-brand">{formatMoney(me.cashbackBalance)}</p>
          <p className="text-xs text-ink-soft">use no caixa</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-ink-soft">Já economizou</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatMoney(me.totalSavings)}</p>
          <p className="text-xs text-ink-soft">
            em {me.purchases} compra{me.purchases === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {me.expiringSoon && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {formatMoney(me.expiringSoon.amount)} de cashback vencem em {new Date(`${me.expiringSoon.date}T00:00:00`).toLocaleDateString('pt-BR')}. Use na próxima compra!
        </p>
      )}
      {offers.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-bold text-ink">Ofertas de membro</h2>
            <NavLink to="/app/produtos" className="text-sm font-medium text-brand">
              Ver tudo
            </NavLink>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {offers.map((p) => (
              <ProductCard key={p.id} p={p} onAdd={onAdd} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Products({ onAdd }: { onAdd?: (p: ShopProduct) => void }) {
  const catalog = useCatalog();
  if (catalog.isLoading) return <Spinner />;
  if (!catalog.data) return <ErrorLine error={catalog.error} />;
  return (
    <div className="pb-16">
      <Catalog
        data={catalog.data}
        onAdd={onAdd}
        header={
          <>
            <h1 className="text-xl font-bold text-ink">Produtos</h1>
            {onAdd && <p className="mb-1 text-sm text-ink-soft">Peça pelo app, pague no caixa e retire pronto.</p>}
          </>
        }
      />
    </div>
  );
}

function Statement() {
  const [tab, setTab] = useState<'cashback' | 'compras' | 'pedidos'>('cashback');
  const cashback = useQuery({ queryKey: ['shop', 'cashback'], queryFn: () => shopApi<ShopCashbackEntry[]>('/me/cashback'), enabled: tab === 'cashback' });
  const purchases = useQuery({ queryKey: ['shop', 'purchases'], queryFn: () => shopApi<ShopPurchase[]>('/me/purchases'), enabled: tab === 'compras' });
  return (
    <div>
      <h1 className="mb-3 text-xl font-bold text-ink">Extrato</h1>
      <div className="mb-3 grid grid-cols-3 rounded-xl bg-white p-1 shadow-sm">
        {(['cashback', 'compras', 'pedidos'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg py-2 text-sm font-semibold ${tab === t ? 'bg-brand text-white' : 'text-ink-soft'}`}>
            {t === 'cashback' ? 'Cashback' : t === 'compras' ? 'Compras' : 'Pedidos'}
          </button>
        ))}
      </div>
      {tab === 'pedidos' ? (
        <OrdersHistory />
      ) : tab === 'cashback' ? (
        cashback.isLoading ? (
          <Spinner />
        ) : !cashback.data?.length ? (
          <Empty>Seu cashback aparece aqui depois da primeira compra como membro.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm">
            {cashback.data.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{e.description}</p>
                  <p className="text-xs text-ink-soft">
                    {new Date(e.createdAt).toLocaleDateString('pt-BR')}
                    {e.expiresAt ? ` · vence ${new Date(`${e.expiresAt}T00:00:00`).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
                <span className={`text-sm font-bold ${e.amount >= 0 ? 'text-brand' : 'text-ink-soft'}`}>
                  {e.amount >= 0 ? '+' : '−'}
                  {formatMoney(Math.abs(e.amount))}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : purchases.isLoading ? (
        <Spinner />
      ) : !purchases.data?.length ? (
        <Empty>Suas compras na loja aparecem aqui.</Empty>
      ) : (
        <ul className="space-y-3">
          {purchases.data.map((p) => (
            <Purchase key={p.id} p={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Purchase({ p }: { p: ShopPurchase }) {
  const [open, setOpen] = useState(false);
  const canceled = p.status === 'canceled';
  return (
    <li className="rounded-2xl bg-white shadow-sm">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div>
          <p className="text-sm font-semibold text-ink">
            {new Date(p.createdAt).toLocaleDateString('pt-BR')} · {p.items.length} ite{p.items.length === 1 ? 'm' : 'ns'}
          </p>
          <p className="text-xs text-ink-soft">{canceled ? 'Compra cancelada' : p.memberSavings > 0 ? `Economizou ${formatMoney(p.memberSavings)}` : `Compra nº ${p.number}`}</p>
        </div>
        <span className={`font-bold ${canceled ? 'text-ink-soft line-through' : 'text-ink'}`}>{formatMoney(p.total)}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm">
          {p.items.map((i, n) => (
            <div key={n} className="flex justify-between gap-3 py-0.5">
              <span className="text-ink">
                {i.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {i.unit.toLowerCase()} · {i.name}
              </span>
              <span className="text-ink-soft">{formatMoney(i.total)}</span>
            </div>
          ))}
          {p.cashbackUsed > 0 && <p className="mt-2 text-xs text-ink-soft">Pagou {formatMoney(p.cashbackUsed)} com cashback</p>}
          {p.cashbackEarned > 0 && !canceled && <p className="text-xs text-brand">Ganhou {formatMoney(p.cashbackEarned)} de cashback</p>}
        </div>
      )}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-ink-soft shadow-sm">{children}</p>;
}

function Account({ me, onSignOut, onToken }: { me: ShopMe; onSignOut: () => void; onToken: (r: ShopLoginResult) => void }) {
  const qc = useQueryClient();
  const info = useInfo();
  const [f, setF] = useState({ name: me.name, email: me.email ?? '', goal: (me.goal ?? '') as CustomerGoal | '', allowWhatsapp: me.allowWhatsapp });
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => shopApi<ShopMe>('/me', { method: 'PUT', json: { name: f.name, email: f.email || null, goal: f.goal || null, allowWhatsapp: f.allowWhatsapp } }),
    onSuccess: (data) => {
      qc.setQueryData(['shop', 'me'], data);
      setSaved(true);
    },
  });
  const club = info.data?.club;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">Minha conta</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate();
        }}
        className="space-y-4 rounded-2xl bg-white p-5 shadow-sm"
      >
        <Input label="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Input label="E-mail (opcional)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <p className="text-sm text-ink-soft">Celular: {formatPhone(me.phone)} (para trocar, fale com a loja)</p>
        <label className="block">
          <span className="text-sm font-medium text-ink">Objetivo</span>
          <select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value as CustomerGoal | '' })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base">
            <option value="">Não informar</option>
            {Object.entries(CUSTOMER_GOALS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={f.allowWhatsapp} onChange={(e) => setF({ ...f, allowWhatsapp: e.target.checked })} />
          Receber ofertas de membro pelo WhatsApp
        </label>
        <ErrorLine error={save.error} />
        {saved && <p className="text-sm text-brand">Dados salvos.</p>}
        <button disabled={save.isPending} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-60">
          Salvar
        </button>
      </form>
      <ChangePin onToken={onToken} />
      {club && (
        <section className="rounded-2xl bg-white p-5 text-sm text-ink shadow-sm">
          <h2 className="mb-2 font-bold">Regras do clube</h2>
          <ul className="space-y-1 text-ink-soft">
            <li>• Preço de membro em toda compra com o seu cartão.</li>
            {club.cashbackPct > 0 && <li>• {club.cashbackPct.toLocaleString('pt-BR')}% do valor pago volta como cashback.</li>}
            {club.cashbackDays > 0 && <li>• O cashback vale {club.cashbackDays} dias.</li>}
            {club.cashbackMaxUsePct < 100 && <li>• Use cashback para pagar até {club.cashbackMaxUsePct.toLocaleString('pt-BR')}% de cada compra.</li>}
          </ul>
          {(info.data?.phone || info.data?.address) && (
            <p className="mt-3 text-ink-soft">
              {info.data?.address}
              {info.data?.phone ? ` · ${formatPhone(info.data.phone)}` : ''}
            </p>
          )}
        </section>
      )}
      <button onClick={onSignOut} className="w-full rounded-xl border border-slate-300 bg-white py-3 font-semibold text-ink">
        Sair deste celular
      </button>
    </div>
  );
}

function ChangePin({ onToken }: { onToken: (r: ShopLoginResult) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current: '', pin: '', pin2: '' });
  const [local, setLocal] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => shopApi<ShopLoginResult>('/me/pin', { method: 'POST', json: { current: f.current, pin: f.pin } }), onSuccess: onToken });
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-xl border border-slate-300 bg-white py-3 font-semibold text-ink">
        Trocar PIN
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setLocal(null);
        if (f.pin !== f.pin2) return setLocal('Os dois PINs novos não estão iguais.');
        m.mutate();
      }}
      className="space-y-3 rounded-2xl bg-white p-5 shadow-sm"
    >
      <h2 className="font-bold">Trocar PIN</h2>
      <Input label="PIN atual" type="password" value={f.current} onChange={(e) => setF({ ...f, current: onlyDigits(e.target.value) })} {...pinProps} required />
      <div className="grid grid-cols-2 gap-3">
        <Input label="PIN novo" type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: onlyDigits(e.target.value) })} {...pinProps} required />
        <Input label="Repita" type="password" value={f.pin2} onChange={(e) => setF({ ...f, pin2: onlyDigits(e.target.value) })} {...pinProps} required />
      </div>
      {local ? <ErrorLine error={new Error(local)} /> : <ErrorLine error={m.error} />}
      <button disabled={m.isPending} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-60">
        Salvar PIN novo
      </button>
    </form>
  );
}

/** Entrou com o código do balcão: cria o próprio PIN antes de seguir. */
function CreatePin({ me, onToken }: { me: ShopMe; onToken: (r: ShopLoginResult) => void }) {
  const [f, setF] = useState({ pin: '', pin2: '' });
  const [local, setLocal] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => shopApi<ShopLoginResult>('/me/pin', { method: 'POST', json: { pin: f.pin } }), onSuccess: onToken });
  return (
    <div className="mx-auto max-w-md px-5 pt-10">
      <Leaf className="h-10 w-10" />
      <h1 className="mt-4 text-2xl font-bold text-ink">Olá, {me.name.split(' ')[0]}!</h1>
      <p className="mt-1 text-ink-soft">Crie seu PIN de 6 números. É com ele que você entra no app daqui pra frente.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setLocal(null);
          if (f.pin !== f.pin2) return setLocal('Os dois PINs não estão iguais.');
          m.mutate();
        }}
        className="mt-6 space-y-4 rounded-2xl bg-white p-5 shadow-sm"
      >
        <Input label="Novo PIN" type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: onlyDigits(e.target.value) })} {...pinProps} required autoFocus />
        <Input label="Repita o PIN" type="password" value={f.pin2} onChange={(e) => setF({ ...f, pin2: onlyDigits(e.target.value) })} {...pinProps} required />
        {local ? <ErrorLine error={new Error(local)} /> : <ErrorLine error={m.error} />}
        <button disabled={m.isPending} className="w-full rounded-xl bg-brand py-3.5 font-semibold text-white disabled:opacity-60">
          Criar PIN e entrar
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ instalar

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** Convite para pôr o app na tela inicial (Android: botão; iPhone: instrução). */
function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('mercearia.install-hint') === 'off';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (hidden || standalone || (!prompt && !ios)) return null;
  const close = () => {
    try {
      localStorage.setItem('mercearia.install-hint', 'off');
    } catch {
      /* ok */
    }
    setHidden(true);
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-brand/20 bg-brand-soft px-4 py-3">
      <Leaf className="h-8 w-8 shrink-0" />
      <p className="flex-1 text-sm text-brand-dark">{prompt ? 'Coloque o app na tela inicial: o cartão abre na hora no caixa.' : 'No iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início".'}</p>
      {prompt && (
        <button onClick={() => prompt.prompt().then(close)} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          Instalar
        </button>
      )}
      <button onClick={close} aria-label="Fechar" className="px-1 text-xl leading-none text-brand-dark/60">
        ×
      </button>
    </div>
  );
}
