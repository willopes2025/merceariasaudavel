import { BrandLogo, BrandMark } from '../brand/Brand';
import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { SessionUser } from '@mercearia/contracts';
import { api, can, session } from '../lib/api';
import { activePath, visibleNav } from '../lib/nav';
import { Loading } from './ui';

const GRUPOS = 'mercearia.menu.fechados';
const ESCONDIDO = 'mercearia.menu.escondido';
function ler<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(chave);
    return v == null ? padrao : (JSON.parse(v) as T);
  } catch {
    return padrao;
  }
}
function gravar(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento */
  }
}

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

  // Grupos recolhidos e menu escondido ficam guardados neste navegador.
  const [fechados, setFechados] = useState<Set<string>>(() => new Set(ler<string[]>(GRUPOS, [])));
  const [escondido, setEscondido] = useState(() => ler<boolean>(ESCONDIDO, false));
  const mudar = (n: Set<string>) => {
    setFechados(n);
    gravar(GRUPOS, [...n]);
  };
  const alternar = (k: string) => {
    const n = new Set(fechados);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    mudar(n);
  };
  const todosFechados = groups.length > 0 && groups.every((g) => fechados.has(g.key));
  const esconder = (v: boolean) => {
    setEscondido(v);
    gravar(ESCONDIDO, v);
  };

  const menu = (
    <nav aria-label="Menu principal" className="space-y-3">
      <button className="flex w-full items-center justify-end gap-1 px-3 text-[11px] text-cream/50 hover:text-white" onClick={() => mudar(todosFechados ? new Set() : new Set(groups.map((g) => g.key)))}>
        {todosFechados ? 'Expandir tudo ▾' : 'Recolher tudo ▴'}
      </button>
      {groups.map((group) => {
        const fechado = fechados.has(group.key);
        const temAtiva = group.items.some((i) => i.path === active);
        return (
          <div key={group.key}>
            <button
              className="mb-1 flex w-full items-center justify-between rounded px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-sun/80 hover:bg-white/5 hover:text-sun"
              aria-expanded={!fechado}
              aria-controls={`menu-${group.key}`}
              onClick={() => alternar(group.key)}
            >
              <span>
                {group.label}
                {fechado && temAtiva && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-sun align-middle" title="Você está nesta área" />}
              </span>
              <span aria-hidden="true" className={`text-xs transition-transform ${fechado ? '-rotate-90' : ''}`}>▾</span>
            </button>
            {!fechado && (
              <ul id={`menu-${group.key}`}>
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
            )}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full">
      {!escondido && (
        <aside className="relative hidden w-64 shrink-0 overflow-y-auto bg-ink px-3 py-6 lg:block">
          <button className="absolute right-2 top-2 rounded px-2 py-1 text-sm text-cream/50 hover:bg-white/10 hover:text-white" title="Esconder o menu" aria-label="Esconder o menu" onClick={() => esconder(true)}>
            «
          </button>
          <div className="mb-7 px-3">
            <Logo light />
          </div>
          {menu}
        </aside>
      )}

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
            {escondido && (
              <button className="btn-ghost hidden px-3 lg:inline-flex" title="Mostrar o menu" aria-label="Mostrar o menu" onClick={() => esconder(false)}>
                » Menu
              </button>
            )}
            <BrandMark className={`h-6 w-6 ${escondido ? '' : 'lg:hidden'}`} />
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
