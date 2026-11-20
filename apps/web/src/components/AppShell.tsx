import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { SessionUser } from '@mercearia/contracts';
import { api, can, session } from '../lib/api';
import { activePath, visibleNav } from '../lib/nav';
import { Loading } from './ui';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`flex items-center gap-2 text-lg font-bold tracking-wide ${light ? 'text-white' : 'text-brand'}`}>
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden fill="none" stroke="#B8E06A" strokeWidth="1.8">
        <path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15z" fill="rgba(184,224,106,.2)" />
        <path d="M5 19l8-8" />
      </svg>
      Mercearia Saudável
    </span>
  );
}

/**
 * Moldura do sistema: menu lateral com as áreas e o conteúdo ao lado.
 * No celular o menu vira gaveta. As permissões são relidas a cada 5 minutos,
 * então tirar um acesso some do menu sem precisar sair e entrar.
 */
export function AppShell({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<SessionUser>('/auth/me'),
    refetchInterval: 5 * 60_000,
    initialData: session.user() ?? undefined,
  });
  useEffect(() => {
    if (me.data) session.updateUser(me.data);
  }, [me.data]);
  useEffect(() => setDrawer(false), [location.pathname]);

  const permissions = me.data?.permissions ?? [];
  const groups = visibleNav((p) => can(p, permissions));
  const active = activePath(location.pathname);

  const menu = (
    <nav aria-label="Menu principal" className="space-y-5">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/50">{group.label}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                    active === item.path ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.phase > 0 && <span className="text-[10px] text-white/40">Fase {item.phase}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 overflow-y-auto bg-brand px-3 py-5 lg:block">
        <div className="mb-6 px-3">
          <Logo light />
        </div>
        {menu}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button aria-label="Fechar menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="relative h-full w-72 overflow-y-auto bg-brand px-3 py-5">{menu}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <button className="btn-ghost px-3 lg:hidden" onClick={() => setDrawer(true)} aria-label="Abrir menu">
              Menu
            </button>
            <span className="text-sm text-ink-soft">{me.data?.tenantName}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-ink sm:inline">{me.data?.name}</span>
            <button className="text-ink-soft hover:text-ink" onClick={onSignOut}>
              Sair
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
