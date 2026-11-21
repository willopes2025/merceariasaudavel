import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, type OnlineMethod, type OnlinePaymentView } from '@mercearia/contracts';
import { ApiError } from '../lib/api';
import { Qr } from './parts';

type Poll = OnlinePaymentView | { status: null };

const left = (iso: string) => {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Pagar pelo app/totem: botões de Pix e cartão; Pix mostra o QR e o copia e
 * cola, cartão abre a página do Mercado Pago. Pergunta de 4 em 4 s até pagar.
 */
export function OnlinePay({
  id,
  methods,
  start,
  poll,
  onPaid,
  big = false,
  preferred,
}: {
  /** Pedido (chave da consulta). */
  id: string;
  methods: OnlineMethod[];
  start: (m: OnlineMethod) => Promise<OnlinePaymentView>;
  poll: () => Promise<Poll>;
  onPaid?: () => void;
  big?: boolean;
  /** Já começa gerando este (a cliente escolheu no carrinho). */
  preferred?: OnlineMethod | null;
}) {
  const [, tick] = useState(0);
  const state = useQuery({ queryKey: ['online-pay', id], queryFn: poll, refetchInterval: (q) => (q.state.data?.status === 'pendente' ? 4_000 : false) });
  const go = useMutation({ mutationFn: start, onSuccess: () => state.refetch() });
  const [copied, setCopied] = useState(false);
  const view = state.data && state.data.status ? (state.data as OnlinePaymentView) : null;

  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (view?.status === 'pago') onPaid?.();
  }, [view?.status, onPaid]);
  // Escolheu no carrinho: gera direto (uma vez), se ainda não tem nada aberto.
  const [auto, setAuto] = useState(Boolean(preferred));
  useEffect(() => {
    if (auto && state.isFetched && preferred && (!view || ['expirado', 'cancelado'].includes(view.status)) && !go.isPending) {
      setAuto(false);
      if (!view) go.mutate(preferred);
    }
  }, [auto, state.isFetched, view, preferred, go]);

  if (state.isLoading) return null;
  const text = big ? 'text-xl' : 'text-sm';

  if (view?.status === 'pago') return <p className={`rounded-2xl bg-emerald-50 p-4 text-center font-semibold text-emerald-800 ${text}`}>Pagamento confirmado ✓</p>;
  if (view?.status === 'divergente') return <p className={`rounded-2xl bg-amber-50 p-4 text-center text-amber-800 ${text}`}>Recebemos um valor diferente do pedido. Fale com o balcão.</p>;
  if (view?.status === 'estornado') return <p className={`rounded-2xl bg-slate-100 p-4 text-center ${text}`}>O pagamento foi devolvido.</p>;

  if (view?.status === 'pendente' && view.method === 'pix' && view.qrCode)
    return (
      <section className={`rounded-2xl bg-white p-4 text-center shadow-sm ${big ? 'text-ink' : ''}`}>
        <p className={`font-semibold ${big ? 'text-2xl' : ''}`}>Pague {formatMoney(view.amount)} com Pix</p>
        <p className={`text-ink-soft ${text}`}>Abra o app do banco, escolha Pix e leia o código{big ? ' com o celular' : ''}.</p>
        <Qr value={view.qrCode} size={big ? 300 : 220} className="mx-auto my-3" />
        {!big && (
          <button
            className="w-full rounded-xl border border-brand py-2.5 font-semibold text-brand"
            onClick={() => {
              void navigator.clipboard?.writeText(view.qrCode!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            }}
          >
            {copied ? 'Copiado ✓ cole no app do banco' : 'Copiar código Pix (copia e cola)'}
          </button>
        )}
        <p className={`mt-2 text-ink-soft ${text}`}>
          <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-brand" /> Esperando o pagamento · vence em {left(view.expiresAt)}
        </p>
        {view.test && <p className="mt-1 text-xs text-amber-700">Modo de teste: nada é cobrado.</p>}
      </section>
    );

  if (view?.status === 'pendente' && view.method === 'cartao' && view.checkoutUrl)
    return (
      <section className="rounded-2xl bg-white p-4 text-center shadow-sm">
        <p className="font-semibold">Pague {formatMoney(view.amount)} com cartão</p>
        <a href={view.checkoutUrl} className="mt-3 block w-full rounded-xl bg-brand py-3 font-semibold text-white">
          Ir para o pagamento seguro
        </a>
        <p className="mt-2 text-xs text-ink-soft">Página do Mercado Pago: os dados do cartão não passam pela loja. Depois de pagar, você volta para cá.</p>
        {methods.includes('pix') && (
          <button className="mt-2 text-sm text-brand underline" onClick={() => go.mutate('pix')}>
            Prefiro pagar com Pix
          </button>
        )}
        {view.test && <p className="mt-1 text-xs text-amber-700">Modo de teste: nada é cobrado.</p>}
      </section>
    );

  const error = go.error instanceof ApiError ? go.error.message : go.error ? 'Não deu para gerar o pagamento agora.' : null;
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ${big ? 'text-center' : ''}`}>
      {view && ['expirado', 'cancelado'].includes(view.status) && <p className={`mb-2 text-ink-soft ${text}`}>{view.status === 'expirado' ? 'O Pix venceu. Gere outro:' : 'Pagamento cancelado. Tente de novo:'}</p>}
      {!view && !big && <p className="mb-2 text-sm font-medium text-ink">Pague agora pelo app e o preparo começa sozinho:</p>}
      <div className={`grid gap-2 ${methods.length > 1 ? 'grid-cols-2' : ''}`}>
        {methods.map((m) => (
          <button key={m} disabled={go.isPending} onClick={() => go.mutate(m)} className={`rounded-xl bg-brand font-semibold text-white disabled:opacity-60 ${big ? 'py-5 text-2xl' : 'py-3'}`}>
            {go.isPending && go.variables === m ? 'Gerando…' : m === 'pix' ? 'Pagar com Pix' : 'Pagar com cartão'}
          </button>
        ))}
      </div>
      {error && <p className={`mt-2 text-red-600 ${text}`}>{error}</p>}
    </section>
  );
}
