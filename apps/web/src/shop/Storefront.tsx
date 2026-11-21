import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { formatMoney, formatPhone, productPath, whatsappLink, type ShopCatalog, type ShopKit, type ShopLoginResult, type ShopMe, type ShopProduct } from '@mercearia/contracts';
import { OptionPicker } from '../components/OptionPicker';
import { customerSession, shopApi } from './api';
import { useCart, type CartLine } from './cart';
import { CartLines, Kits, LoginForm, SignupForm, Tracking, useInfo } from './CustomerApp';
import { Catalog, Leaf, ProductCard, Spinner, effectivePrice, saving } from './parts';
import { captureOrigin, track } from './track';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
const CART_KEY = 'mercearia.carrinho.loja';
type Cart = ReturnType<typeof useCart>;

/**
 * Loja online (/loja): vitrine aberta, sem login. Produto tem página própria
 * (/loja/p/<id>/<nome>) para Google e anúncios. Para fechar o pedido a cliente
 * entra ou vira membro (grátis) e o carrinho segue para o app, onde escolhe
 * retirada/entrega e paga.
 */
export function Storefront() {
  useEffect(() => {
    captureOrigin();
  }, []);
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Shop />
      </BrowserRouter>
      <Tracking />
    </QueryClientProvider>
  );
}

const useCatalog = () => useQuery({ queryKey: ['shop', 'catalog'], queryFn: () => shopApi<ShopCatalog>('/catalog'), staleTime: 60_000 });

function Shop() {
  const info = useInfo();
  const cart = useCart(CART_KEY);
  const signedIn = Boolean(customerSession.token());
  const ordering = Boolean(info.data?.ordersEnabled);
  const [picking, setPicking] = useState<ShopProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [auth, setAuth] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const add = (p: ShopProduct, qty = 1) => {
    if (p.optionGroups.length) return setPicking(p);
    cart.add(p, qty);
    track('AddToCart', { value: effectivePrice(p, true) * qty, ids: [p.id], name: p.name });
    setAdded(p.name);
    setTimeout(() => setAdded(null), 2200);
  };
  const onAdd = ordering ? (p: ShopProduct) => add(p) : undefined;

  async function checkout() {
    track('InitiateCheckout', { value: cart.total(true), ids: cart.lines.map((l) => l.product.id) });
    if (!customerSession.token()) return setAuth(true);
    await moveCartToApp(cart);
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/loja" className="flex items-center gap-2">
            <Leaf className="h-8 w-8" />
            <span className="font-display text-xl font-semibold text-brand">{info.data?.storeName || 'Mercearia Saudável'}</span>
          </Link>
          <div className="flex-1" />
          <a href="/app" className="hidden text-sm font-medium text-brand sm:block">
            {signedIn ? 'Minha conta' : 'Entrar'}
          </a>
          {ordering && (
            <button onClick={() => setCartOpen(true)} className="relative rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white" aria-label="Carrinho">
              🛒 {cart.count > 0 ? `${cart.count} · ${formatMoney(cart.total(signedIn))}` : 'Carrinho'}
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-24">
        <Routes>
          <Route path="/loja" element={<Home onAdd={onAdd} onAddKit={ordering ? (k) => k.items.forEach((i) => add(i.product, i.quantity)) : undefined} onJoin={() => setAuth(true)} signedIn={signedIn} />} />
          <Route path="/loja/p/:id/*" element={<ProductPage onAdd={ordering ? add : undefined} />} />
          <Route path="/loja/p/:id" element={<ProductPage onAdd={ordering ? add : undefined} />} />
          <Route path="*" element={<Home onAdd={onAdd} onJoin={() => setAuth(true)} signedIn={signedIn} />} />
        </Routes>
      </main>
      <Footer />
      {added && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <button onClick={() => setCartOpen(true)} className="rounded-2xl bg-ink px-5 py-3 text-sm text-white shadow-xl">
            ✓ {added} no carrinho · <b>ver carrinho</b>
          </button>
        </div>
      )}
      {picking && (
        <OptionPicker
          title={picking.name}
          groups={picking.optionGroups}
          basePrice={effectivePrice(picking, false)}
          memberPrice={effectivePrice(picking, true)}
          onClose={() => setPicking(null)}
          onConfirm={(picked, qty) => {
            cart.add(picking, qty, picked);
            track('AddToCart', { value: (effectivePrice(picking, true) + picked.extras) * qty, ids: [picking.id], name: picking.name });
            setPicking(null);
          }}
        />
      )}
      {cartOpen && <CartDrawer cart={cart} member={signedIn} onClose={() => setCartOpen(false)} onCheckout={() => void checkout()} />}
      {auth && <AuthSheet onClose={() => setAuth(false)} onDone={async (r) => { customerSession.save(r.token); setAuth(false); if (cart.count) await moveCartToApp(cart); else window.location.href = '/app'; }} />}
    </div>
  );
}

/** Leva o carrinho da loja para o carrinho do app da cliente e abre o fechamento. */
async function moveCartToApp(cart: Cart) {
  const me = await shopApi<ShopMe>('/me');
  const key = `mercearia.carrinho.${me.id}`;
  let lines: CartLine[] = [];
  try {
    lines = JSON.parse(localStorage.getItem(key) ?? '[]') as CartLine[];
  } catch {
    lines = [];
  }
  for (const l of cart.lines) {
    const i = lines.findIndex((x) => x.key === l.key);
    if (i >= 0) lines[i] = { ...lines[i]!, quantity: Math.min(50, lines[i]!.quantity + l.quantity) };
    else lines.push(l);
  }
  try {
    localStorage.setItem(key, JSON.stringify(lines));
    localStorage.removeItem(CART_KEY);
  } catch {
    /* sem armazenamento */
  }
  window.location.href = '/app?carrinho=1';
}

function Home({ onAdd, onAddKit, onJoin, signedIn }: { onAdd?: (p: ShopProduct) => void; onAddKit?: (k: ShopKit) => void; onJoin: () => void; signedIn: boolean }) {
  const info = useInfo();
  const catalog = useCatalog();
  useEffect(() => {
    if (info.data) document.title = `${info.data.storeName || info.data.name} · loja online`;
  }, [info.data]);
  const best = useMemo(() => Math.max(0, ...(catalog.data?.products ?? []).map((p) => (p.available ? Math.round((saving(p) / p.price) * 100) : 0))), [catalog.data]);
  const club = info.data?.club;
  return (
    <div className="space-y-6 pt-4">
      <section className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-6 text-white shadow-lg md:p-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-accent">Loja online</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight md:text-4xl">{info.data?.description ? info.data.description.split('.')[0] : 'Suplementos, Pacco e comida de verdade.'}</h1>
          <p className="mt-3 max-w-xl text-white/90">
            Compre aqui e {info.data?.delivery.enabled ? `receba em casa${info.data.delivery.city ? ` em ${info.data.delivery.city.split(' - ')[0]}` : ''} ou ` : ''}retire na loja.
            {info.data?.online.pix ? ' Pague com Pix na hora.' : ''}
          </p>
        </div>
        <div className="flex flex-col justify-between rounded-3xl bg-white p-6 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-brand">Clube Mercearia · grátis</p>
            <p className="mt-1 text-xl font-bold leading-tight text-ink">Membro paga menos{best > 0 ? `: até ${best}% off` : ''}.</p>
            {club && club.cashbackPct > 0 && <p className="mt-1 text-sm text-ink-soft">E ganha {club.cashbackPct.toLocaleString('pt-BR')}% de volta em cashback.</p>}
          </div>
          {signedIn ? (
            <a href="/app" className="mt-4 rounded-xl border border-brand py-2.5 text-center font-semibold text-brand">
              Abrir meu cartão de membro
            </a>
          ) : (
            <button onClick={onJoin} className="mt-4 rounded-xl bg-brand py-2.5 font-semibold text-white">
              Virar membro grátis
            </button>
          )}
        </div>
      </section>
      {info.data && !info.data.ordersEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Os pedidos online estão pausados agora. Você pode ver os produtos e comprar na loja.</p>}
      {info.data?.campaigns.map((c) => (
        <p key={c.id} className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>{c.name}</b>
          {c.description ? ` — ${c.description}` : ''} · até {c.until.split('-').reverse().slice(0, 2).join('/')}
        </p>
      ))}
      <Kits goal={null} onAddKit={onAddKit} />
      {catalog.isLoading ? <Spinner /> : catalog.data ? <Catalog data={catalog.data} onAdd={onAdd} linkOf={(p) => productPath(p)} /> : <p className="py-10 text-center text-ink-soft">Não deu para carregar os produtos.</p>}
    </div>
  );
}

function ProductPage({ onAdd }: { onAdd?: (p: ShopProduct, qty?: number) => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const info = useInfo();
  const [qty, setQty] = useState(1);
  const [broken, setBroken] = useState(false);
  const p = catalog.data?.products.find((x) => x.id === id);
  useEffect(() => {
    if (p) {
      document.title = `${p.name} | ${info.data?.storeName || 'Mercearia Saudável'}`;
      track('ViewContent', { value: p.price, ids: [p.id], name: p.name });
      window.scrollTo({ top: 0 });
    }
  }, [p, info.data]);
  if (catalog.isLoading) return <Spinner />;
  if (!p)
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Produto não encontrado.</p>
        <Link to="/loja" className="mt-2 inline-block text-brand underline">
          Ver todos os produtos
        </Link>
      </div>
    );
  const off = saving(p);
  const related = (catalog.data?.products ?? []).filter((x) => x.id !== p.id && x.available && x.categoryId === p.categoryId).slice(0, 4);
  const member = effectivePrice(p, true);
  const normal = effectivePrice(p, false);
  return (
    <div className="space-y-8 pt-4">
      <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/loja'))} className="text-sm text-brand">
        ← Voltar
      </button>
      <section className="grid gap-6 md:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-3xl bg-brand-soft">
          {p.imageUrl && !broken ? <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" onError={() => setBroken(true)} /> : <div className="flex h-full items-center justify-center"><Leaf className="h-24 w-24 opacity-60" /></div>}
        </div>
        <div>
          {p.brand && <p className="text-sm font-medium text-ink-soft">{p.brand}</p>}
          <h1 className="text-3xl font-bold leading-tight text-ink">{p.name}</h1>
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            {member < normal ? (
              <>
                <p className="text-sm text-ink-soft">
                  Preço normal <span className="line-through">{formatMoney(normal)}</span>
                </p>
                <p className="text-3xl font-bold text-brand">
                  {formatMoney(member)} <span className="text-base font-semibold">para membro</span>
                </p>
                <p className="mt-1 text-sm text-ink-soft">Ser membro é grátis: economia de {formatMoney(Math.round((normal - member) * 100) / 100)}{off > 0 && p.offer ? '' : ''} nesta compra.</p>
              </>
            ) : (
              <p className="text-3xl font-bold text-ink">{formatMoney(normal)}</p>
            )}
            {p.offer && <p className="mt-1 text-sm font-semibold text-amber-700">Oferta até {p.offer.until.split('-').reverse().slice(0, 2).join('/')}</p>}
            {!p.available ? (
              <p className="mt-3 rounded-xl bg-slate-100 py-3 text-center font-semibold text-ink-soft">Esgotado no momento</p>
            ) : onAdd ? (
              <div className="mt-4 flex gap-2">
                {!p.optionGroups.length && (
                  <div className="flex items-center rounded-xl border border-slate-300">
                    <button className="px-4 py-3 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">
                      −
                    </button>
                    <span className="w-8 text-center font-semibold">{qty}</span>
                    <button className="px-4 py-3 text-lg" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Mais">
                      +
                    </button>
                  </div>
                )}
                <button onClick={() => onAdd(p, qty)} className="flex-1 rounded-xl bg-brand py-3 text-base font-semibold text-white">
                  {p.optionGroups.length ? 'Montar e adicionar' : 'Adicionar ao carrinho'}
                </button>
              </div>
            ) : null}
          </div>
          {p.description && <p className="mt-4 whitespace-pre-line leading-relaxed text-ink">{p.description}</p>}
          <ul className="mt-4 space-y-1 text-sm text-ink-soft">
            <li>✓ Retire na loja{info.data?.delivery.enabled ? ' ou receba em casa' : ''}</li>
            {info.data?.online.pix && <li>✓ Pague com Pix pelo celular</li>}
            {info.data?.club.cashbackPct ? <li>✓ Membro ganha {info.data.club.cashbackPct.toLocaleString('pt-BR')}% de cashback</li> : null}
          </ul>
        </div>
      </section>
      {related.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-ink">Você também pode gostar</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {related.map((r) => (
              <ProductCard key={r.id} p={r} onAdd={onAdd ? (x) => onAdd(x) : undefined} href={productPath(r)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CartDrawer({ cart, member, onClose, onCheckout }: { cart: Cart; member: boolean; onClose: () => void; onCheckout: () => void }) {
  const savingTotal = Math.round((cart.total(false) - cart.total(true)) * 100) / 100;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Carrinho">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Seu carrinho</h2>
          <button onClick={onClose} aria-label="Fechar" className="px-2 text-2xl leading-none text-ink-soft">
            ×
          </button>
        </div>
        {!cart.count ? (
          <p className="py-10 text-center text-ink-soft">O carrinho está vazio.</p>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <CartLines cart={cart} member={member} />
            </div>
            {!member && savingTotal > 0 && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-dark">Membro paga {formatMoney(cart.total(true))} neste carrinho: {formatMoney(savingTotal)} a menos. É grátis!</p>}
            <div className="mt-3 flex items-end justify-between">
              <span className="text-sm text-ink-soft">{member ? 'Total com preço de membro' : 'Total'}</span>
              <span className="text-2xl font-bold text-ink">{formatMoney(cart.total(member))}</span>
            </div>
            <button onClick={onCheckout} className="mt-3 w-full rounded-xl bg-brand py-3.5 text-base font-semibold text-white">
              Finalizar compra
            </button>
            <p className="mt-2 text-center text-xs text-ink-soft">Na próxima tela você escolhe retirar ou receber e como pagar.</p>
          </>
        )}
      </div>
    </div>
  );
}

function AuthSheet({ onClose, onDone }: { onClose: () => void; onDone: (r: ShopLoginResult) => void }) {
  const [mode, setMode] = useState<'cadastro' | 'entrar'>('cadastro');
  const info = useInfo();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Entrar">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{mode === 'cadastro' ? 'Vire membro grátis e pague menos' : 'Entrar'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="px-2 text-2xl leading-none text-ink-soft">
            ×
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          {(['cadastro', 'entrar'] as const).map((k) => (
            <button key={k} onClick={() => setMode(k)} className={`rounded-lg py-2 text-sm font-semibold ${mode === k ? 'bg-white text-brand shadow-sm' : 'text-ink-soft'}`}>
              {k === 'cadastro' ? 'Sou nova aqui' : 'Já sou membro'}
            </button>
          ))}
        </div>
        {mode === 'cadastro' ? <SignupForm onDone={onDone} club={info.data?.club} /> : <LoginForm onDone={onDone} />}
      </div>
    </div>
  );
}

function Footer() {
  const info = useInfo();
  const d = info.data;
  if (!d) return null;
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-2 px-4 py-6 text-sm text-ink-soft sm:grid-cols-3">
        <p className="font-semibold text-ink">{d.storeName || d.name}</p>
        {d.address && <p>{d.address}</p>}
        {d.phone && (
          <a href={whatsappLink(d.phone, 'Olá! Vim pela loja online.')} target="_blank" rel="noreferrer" className="text-brand">
            WhatsApp {formatPhone(d.phone)}
          </a>
        )}
      </div>
    </footer>
  );
}
