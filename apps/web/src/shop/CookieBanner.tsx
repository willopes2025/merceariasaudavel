import { useState } from 'react';
import { consent, setConsent, type Tracking } from './track';

/** Aviso de cookies: aparece só se a loja usa Pixel/Analytics e a pessoa ainda não respondeu. */
export function CookieBanner({ tracking }: { tracking: Tracking | undefined }) {
  const [answered, setAnswered] = useState(consent() !== null);
  if (answered || !tracking || (!tracking.metaPixelId && !tracking.ga4Id)) return null;
  const answer = (v: 'sim' | 'nao') => {
    setConsent(v, tracking);
    setAnswered(true);
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3" role="dialog" aria-label="Cookies">
      <div className="mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl bg-ink p-4 text-sm text-white shadow-xl">
        <p className="flex-1">Usamos cookies para medir nossos anúncios e melhorar a loja. Você aceita?</p>
        <button className="rounded-xl px-3 py-2 text-white/80 underline" onClick={() => answer('nao')}>
          Não
        </button>
        <button className="rounded-xl bg-brand px-4 py-2 font-semibold" onClick={() => answer('sim')}>
          Aceitar
        </button>
      </div>
    </div>
  );
}
