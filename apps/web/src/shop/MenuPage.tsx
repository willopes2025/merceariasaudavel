import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { formatMoney, type ShopCatalog, type ShopInfo } from '@mercearia/contracts';
import { shopApi } from './api';
import { Catalog, Leaf, Qr, Spinner, saving } from './parts';

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

  useEffect(() => {
    document.title = 'Cardápio — Mercearia Saudável';
  }, []);

  // Totem: 90 s sem toque volta tudo ao começo (busca limpa, topo da página).
  useEffect(() => {
    if (!totem) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        window.scrollTo({ top: 0 });
        setResetKey((k) => k + 1);
      }, 90_000);
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
    <div className="min-h-full bg-[#F6F8F4]">
      <div className={`mx-auto px-4 pb-16 ${totem ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <header className="flex items-center gap-3 py-5">
          <Leaf className={totem ? 'h-12 w-12' : 'h-9 w-9'} />
          <div>
            <p className={`${totem ? 'text-3xl' : 'text-xl'} font-bold text-brand-dark`}>{info.data?.storeName ?? 'Mercearia Saudável'}</p>
            <p className="text-sm text-ink-soft">Cardápio e preços</p>
          </div>
        </header>

        <section className={`mb-4 flex items-center gap-4 rounded-3xl bg-gradient-to-br from-brand to-brand-dark text-white shadow-lg ${totem ? 'p-6' : 'p-5'}`}>
          <div className="flex-1">
            <p className={`${totem ? 'text-3xl' : 'text-xl'} font-bold leading-tight`}>Membro paga menos.</p>
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
          <Catalog key={resetKey} data={catalog.data} big={totem} />
        ) : (
          <p className="py-16 text-center text-ink-soft">Não foi possível carregar o cardápio. Puxe a tela para tentar de novo.</p>
        )}
      </div>
    </div>
  );
}
