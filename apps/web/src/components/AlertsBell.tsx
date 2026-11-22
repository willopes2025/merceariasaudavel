import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import type { Alert } from '@mercearia/contracts';
import { api } from '../lib/api';

/** Sino do topo: o que pede atenção agora (contas, estoque, validades, WhatsApp, notas, pedidos, ponto). */
export function AlertsBell() {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const local = useLocation();
  const q = useQuery({ queryKey: ['avisos'], queryFn: () => api<Alert[]>('/alerts'), refetchInterval: 2 * 60_000 });
  useEffect(() => setAberto(false), [local.pathname]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const avisos = q.data ?? [];
  const urgentes = avisos.filter((a) => a.level === 'urgente').length;
  return (
    <div className="relative" ref={caixa}>
      <button className="relative rounded-lg px-2 py-1 text-lg hover:bg-slate-100" aria-label={`Avisos (${avisos.length})`} title="Avisos" onClick={() => setAberto(!aberto)}>
        🔔
        {avisos.length > 0 && <span className={`absolute -right-1 -top-1 min-w-[18px] rounded-full px-1 text-center text-[11px] font-medium text-white ${urgentes ? 'bg-red-600' : 'bg-amber-500'}`}>{avisos.length}</span>}
      </button>
      {aberto && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-ink">Avisos</div>
          {!avisos.length ? <div className="p-4 text-sm text-ink-soft">Nada pedindo atenção agora. 👍</div> : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {avisos.map((a) => (
                <li key={a.key}>
                  <Link to={a.path} className="flex gap-3 px-4 py-3 hover:bg-cream/60">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.level === 'urgente' ? 'bg-red-600' : 'bg-amber-500'}`} />
                    <span><span className="block text-sm font-medium text-ink">{a.title}</span><span className="block text-xs text-ink-soft">{a.detail}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
