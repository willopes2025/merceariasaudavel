import { useCallback, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, type OnlinePaymentView, type Order, type ShopCatalog, type ShopInfo, type ShopProduct } from '@mercearia/contracts';
import { OnlinePay } from './OnlinePay';
import { OptionPicker } from '../components/OptionPicker';
import { shopApi } from './api';
import { useCart } from './cart';
import { Catalog, Leaf, Qr, Spinner, effectivePrice, saving } from './parts';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 2 } } });

/**
 * Cardápio público (/cardapio): o QR da mesa, da vitrine e do balcão abre aqui.
 * Mostra preço normal e preço de membro lado a lado e chama para o app.
 * Modo totem (/cardapio?totem=1): letras maiores, QR para virar membro sempre
 * à vista, recarrega o catálogo a cada 5 min e volta ao topo quando ninguém mexe.
 */
export function MenuPage() {
  return (
    <QueryClientProvider client={client}>
      <Menu />
    </QueryClientProvider>
  );
}

function Menu() {
  const totem = new URLSearchParams(window.location.search).has('totem');
  const info = useQuery({ queryKey: ['info'], queryFn: () => shopApi<ShopInfo>('') });
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => shopApi<ShopCatalog>('/catalog'), refetchInterval: totem ? 5 * 60_000 : false });
  const [resetKey, setResetKey] = useState(0);
  const cart = useCart('mercearia.carrinho.totem');
  const ordering = totem && Boolean(info.data?.ordersEnabled);
  const [picking, setPicking] = useState<ShopProduct | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);
  const onAdd = ordering ? (p: ShopProduct) => (p.optionGroups.length ? setPicking(p) : cart.add(p)) : undefined;
  const startOver = () => {
    cart.clear();
    setPicking(null);
    setCheckout(false);
    setPlaced(null);
    window.scrollTo({ top: 0 });
    setResetKey((k) => k + 1);
  };

  useEffect(() => {
    document.title = 'Cardápio — Mercearia Saudável';
  }, []);

  const startOverRef = useRef(startOver);
  startOverRef.current = startOver;
  const placedRef = useRef(placed);
  placedRef.current = placed;
  // Totem: 90 s sem toque volta tudo ao começo (busca limpa, carrinho vazio, topo da página).
  useEffect(() => {
    if (!totem) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (placedRef.current ? arm() : startOverRef.current()), 90_000);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [totem]);

  const appUrl = `${window.location.origin}/app`;
  const best = Math.max(0, ...(catalog.data?.products ?? []).map((p) => (p.available ? saving(p) : 0)));
  const cashback = info.data?.club.cashbackPct ?? 0;

  return (
    <div className="min-h-full bg-cream">
      <div className={`mx-auto px-4 pb-16 ${totem ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <header className="flex items-center gap-3 py-5">
          <Leaf className={totem ? 'h-12 w-12' : 'h-9 w-9'} />
          <div>
            <p className={`${totem ? 'text-4xl' : 'text-2xl'} font-display font-semibold text-brand`}>{info.data?.storeName ?? 'Mercearia Saudável'}</p>
            <p className="text-sm text-ink-soft">Cardápio e preços</p>
          </div>
        </header>

        <section className={`mb-4 flex items-center gap-4 rounded-3xl bg-gradient-to-br from-brand to-brand-dark text-white shadow-lg ${totem ? 'p-6' : 'p-5'}`}>
          <div className="flex-1">
            <p className={`${totem ? 'text-4xl' : 'text-2xl'} font-display font-semibold leading-tight`}>Membro paga menos.</p>
            <p className={`mt-1 ${totem ? 'text-lg' : 'text-sm'} text-white/85`}>
              Cadastro grátis no app em 30 segundos{best > 0 ? `: até ${formatMoney(best)} de desconto por item` : ''}
              {cashback > 0 ? ` e ${cashback.toLocaleString('pt-BR')}% de volta em cashback` : ''}.
            </p>
            {!totem && (
              <a href="/app" className="mt-3 inline-block rounded-xl bg-brand-accent px-4 py-2.5 text-sm font-bold text-brand-dark">
                Quero ser membro
              </a>
            )}
          </div>
          {totem && (
            <div className="flex flex-col items-center gap-1">
              <div className="rounded-2xl bg-white p-2">
                <Qr value={appUrl} size={150} />
              </div>
              <p className="text-sm font-medium text-brand-accent">Aponte a câmera</p>
            </div>
          )}
        </section>

        {catalog.isLoading ? (
          <Spinner />
        ) : catalog.data ? (
          <div className={ordering && cart.count ? 'pb-28' : ''}>
            <Catalog key={resetKey} data={catalog.data} big={totem} onAdd={onAdd} />
          </div>
        ) : (
          <p className="py-16 text-center text-ink-soft">Não foi possível carregar o cardápio. Puxe a tela para tentar de novo.</p>
        )}
      </div>
      {ordering && cart.count > 0 && !checkout && !placed && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4">
            <p className="flex-1 text-lg">
              <b>{cart.count}</b> ite{cart.count === 1 ? 'm' : 'ns'} · <b>{formatMoney(cart.total(false))}</b>
              {cart.total(true) < cart.total(false) && <span className="ml-2 text-brand">membro paga {formatMoney(cart.total(true))}</span>}
            </p>
            <button onClick={cart.clear} className="rounded-xl border border-slate-300 px-5 py-4 text-lg text-ink">
              Limpar
            </button>
            <button onClick={() => setCheckout(true)} className="rounded-xl bg-brand px-8 py-4 text-lg font-bold text-white">
              Fechar pedido
            </button>
          </div>
        </div>
      )}
      {picking && (
        <OptionPicker
          big
          title={picking.name}
          groups={picking.optionGroups}
          basePrice={effectivePrice(picking, false)}
          memberPrice={effectivePrice(picking, true)}
          onClose={() => setPicking(null)}
          onConfirm={(picked, qty) => {
            cart.add(picking, qty, picked);
            setPicking(null);
          }}
        />
      )}
      {checkout && <TotemCheckout cart={cart} onClose={() => setCheckout(false)} onPlaced={(o) => { cart.clear(); setCheckout(false); setPlaced(o); }} />}
      {placed && <TotemPlaced order={placed} online={Boolean(info.data?.online.totem)} onDone={startOver} />}
    </div>
  );
}

type Cart = ReturnType<typeof useCart>;

function TotemCheckout({ cart, onClose, onPlaced }: { cart: Cart; onClose: () => void; onPlaced: (o: Order) => void }) {
  const [callName, setCallName] = useState('');
  const [member, setMember] = useState('');
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: () => shopApi<Order>('/totem/orders', { method: 'POST', json: { items: cart.items, callName, member: member || null, notes: notes || null } }),
    onSuccess: onPlaced,
  });
  const input = 'mt-1 w-full rounded-xl border border-slate-300 px-4 py-4 text-xl outline-none focus:border-brand';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-2xl space-y-4 rounded-3xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-ink">Fechar pedido</h2>
          <button type="button" onClick={onClose} className="px-2 text-3xl leading-none text-ink-soft" aria-label="Voltar">
            ×
          </button>
        </div>
        <ul className="max-h-48 overflow-y-auto text-lg">
          {cart.lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-3 py-1">
              <span>
                <b>{l.quantity}×</b> {l.product.name}
                {l.optionNames.length > 0 && <span className="text-base text-ink-soft"> ({l.optionNames.join(', ')})</span>}
              </span>
              <button type="button" className="text-base text-red-600" onClick={() => cart.setQty(l.key, l.quantity - 1)}>
                tirar 1
              </button>
            </li>
          ))}
        </ul>
        <label className="block text-lg font-medium">
          Seu nome (para chamar no balcão)
          <input className={input} value={callName} onChange={(e) => setCallName(e.target.value)} maxLength={30} autoFocus required />
        </label>
        <label className="block text-lg font-medium">
          É membro? Celular ou código do cartão <span className="text-base font-normal text-ink-soft">(opcional)</span>
          <input className={input} value={member} onChange={(e) => setMember(e.target.value)} inputMode="text" placeholder="(27) 99999-9999 ou ABC234" />
        </label>
        <label className="block text-lg font-medium">
          Observação <span className="text-base font-normal text-ink-soft">(opcional)</span>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Ex.: sem gelo" />
        </label>
        <div className="flex items-end justify-between border-t border-slate-100 pt-3 text-lg">
          <span>
            Total {formatMoney(cart.total(false))}
            {cart.total(true) < cart.total(false) && <span className="ml-2 text-brand">· membro {formatMoney(cart.total(true))}</span>}
          </span>
        </div>
        {m.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-lg text-red-700">{(m.error as Error).message}</p>}
        <button disabled={m.isPending || !cart.count} className="w-full rounded-2xl bg-brand py-5 text-xl font-bold text-white disabled:opacity-60">
          {m.isPending ? 'Enviando…' : 'Confirmar e pagar no caixa'}
        </button>
      </form>
    </div>
  );
}

function TotemPlaced({ order, online, onDone }: { order: Order; online: boolean; onDone: () => void }) {
  const [paying, setPaying] = useState(online);
  const [paid, setPaid] = useState(false);
  const [left, setLeft] = useState(online ? 180 : 20);
  useEffect(() => {
    const t = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);
  const onPaid = useCallback(() => {
    setPaid(true);
    setLeft(12);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-brand-dark p-8 text-center text-white" onClick={paying && !paid ? undefined : onDone}>
      <Leaf className="h-12 w-12" />
      <p className="mt-4 text-2xl text-white/80">Obrigado, {order.callName}! Seu pedido é o</p>
      <p className={`${paying && !paid ? 'text-8xl' : 'text-[10rem]'} font-bold leading-none tabular-nums text-brand-accent`}>{order.number}</p>
      {paying && !paid ? (
        <div className="mt-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <OnlinePay
            id={order.id}
            big
            methods={['pix']}
            preferred="pix"
            start={() => shopApi<OnlinePaymentView>(`/totem/orders/${order.id}/pay`, { method: 'POST' })}
            poll={() => shopApi<OnlinePaymentView | { status: null }>(`/totem/orders/${order.id}/pay`)}
            onPaid={onPaid}
          />
          <button className="mt-4 text-xl text-white/80 underline" onClick={() => { setPaying(false); setLeft(20); }}>
            Prefiro pagar no caixa
          </button>
        </div>
      ) : paid ? (
        <p className="mt-4 text-3xl font-bold">Pago! Já foi para o preparo. Acompanhe na TV de retirada.</p>
      ) : (
        <>
          <p className="mt-4 text-3xl font-bold">Pague no caixa e acompanhe na TV de retirada.</p>
          <p className="mt-2 text-xl text-white/70">Valor estimado {formatMoney(order.estimate)}{order.customerId ? ' (preço de membro)' : ''}</p>
        </>
      )}
      <p className="mt-8 text-lg text-white/50">{paying && !paid ? `Volta ao começo em ${left} s` : `Toque para fazer outro pedido (${left})`}</p>
    </div>
  );
}
