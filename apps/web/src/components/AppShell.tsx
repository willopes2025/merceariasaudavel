import { BrandLogo, BrandMark } from '../brand/Brand';
import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { SessionUser } from '@mercearia/contracts';
import { api, can, session } from '../lib/api';
import { activePath, visibleNav } from '../lib/nav';
import { Loading } from './ui';

/** Marca no topo do menu (logo circular em creme e laranja). */
export function Logo({ light = false }: { light?: boolean }) {
  return <BrandLogo light={light} className="mx-auto h-28" />;
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
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-sun/80">{group.label}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center justify-between rounded-lg border-l-[3px] px-3 py-1.5 text-sm transition ${
                    active === item.path ? 'border-sun bg-white/10 font-medium text-white' : 'border-transparent text-cream/75 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.phase > 0 && <span className="text-[10px] text-cream/40">Fase {item.phase}</span>}
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
      <aside className="hidden w-64 shrink-0 overflow-y-auto bg-ink px-3 py-6 lg:block">
        <div className="mb-7 px-3">
          <Logo light />
        </div>
        {menu}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button aria-label="Fechar menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="relative h-full w-72 overflow-y-auto bg-ink px-3 py-5">
            <div className="mb-6 px-3">
              <Logo light />
            </div>
            {menu}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button className="btn-ghost px-3 lg:hidden" onClick={() => setDrawer(true)} aria-label="Abrir menu">
              Menu
            </button>
            <BrandMark className="h-6 w-6 lg:hidden" />
            <span className="font-display text-sm font-medium text-ink-soft">{me.data?.tenantName}</span>
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
