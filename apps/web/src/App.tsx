import { Suspense, lazy, useState, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, session, whenSessionExpires } from './lib/api';
import { upcomingItems } from './lib/nav';
import { AppShell } from './components/AppShell';
import { LoginScreen } from './screens/LoginScreen';
import { ComingSoonScreen } from './screens/ComingSoonScreen';

/**
 * Tela carregada sob demanda. Depois de um deploy, a aba aberta pode pedir um
 * arquivo da versão anterior que já não existe: recarrega uma vez e pega a nova.
 * (Mesmo truque do Soul ERP.)
 */
function screen<M, C extends ComponentType<any>>(load: () => Promise<M>, pick: (m: M) => C) {
  return lazy(async () => {
    try {
      const m = await load();
      sessionStorage.removeItem('mercearia.reloaded');
      return { default: pick(m) };
    } catch (e) {
      if (!sessionStorage.getItem('mercearia.reloaded')) {
        sessionStorage.setItem('mercearia.reloaded', '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw e;
    }
  });
}

const StoresScreen = screen(() => import('./screens/settings/StoresScreen'), (m) => m.StoresScreen);
const UsersScreen = screen(() => import('./screens/settings/UsersScreen'), (m) => m.UsersScreen);
const FiscalSettingsScreen = screen(() => import('./screens/settings/FiscalSettingsScreen'), (m) => m.FiscalSettingsScreen);
const ClubScreen = screen(() => import('./screens/settings/ClubScreens'), (m) => m.ClubScreen);
const CategoriesScreen = screen(() => import('./screens/settings/ClubScreens'), (m) => m.CategoriesScreen);
const FiscalScreen = screen(() => import('./screens/fiscal/FiscalScreen'), (m) => m.FiscalScreen);
const DashboardScreen = screen(() => import('./screens/management/ManagementScreens'), (m) => m.DashboardScreen);
const GoalsScreen = screen(() => import('./screens/management/ManagementScreens'), (m) => m.GoalsScreen);
const TvScreensScreen = screen(() => import('./screens/management/ManagementScreens'), (m) => m.TvScreensScreen);
const TvPage = screen(() => import('./screens/management/TvPage'), (m) => m.TvPage);
const PdvScreen = screen(() => import('./screens/pdv/PdvScreen'), (m) => m.PdvScreen);
const SalesScreen = screen(() => import('./screens/sales/SalesScreen'), (m) => m.SalesScreen);
const SaleScreen = screen(() => import('./screens/sales/SalesScreen'), (m) => m.SaleScreen);
const CashScreen = screen(() => import('./screens/cash/CashScreen'), (m) => m.CashScreen);
const ProductsScreen = screen(() => import('./screens/products/ProductsScreen'), (m) => m.ProductsScreen);
const ExpiringScreen = screen(() => import('./screens/kitchen/KitchenScreens'), (m) => m.ExpiringScreen);
const CountScreen = screen(() => import('./screens/kitchen/KitchenScreens'), (m) => m.CountScreen);
const LossesScreen = screen(() => import('./screens/kitchen/KitchenScreens'), (m) => m.LossesScreen);
const CustomersScreen = screen(() => import('./screens/customers/CustomersScreens'), (m) => m.CustomersScreen);
const CustomerScreen = screen(() => import('./screens/customers/CustomersScreens'), (m) => m.CustomerScreen);
const PayablesScreen = screen(() => import('./screens/finance/PayablesScreen'), (m) => m.PayablesScreen);
const ReportScreen = screen(() => import('./screens/finance/ReportScreen'), (m) => m.ReportScreen);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Sem permissão ou sem sessão, tentar de novo não muda nada.
      retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
    },
  },
});

export function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(session.token()));
  whenSessionExpires(() => setSignedIn(false));

  const signOut = () => {
    session.clear();
    queryClient.clear();
    setSignedIn(false);
  };

  // Tela da TV: abre sem login, só com o token do link.
  const tvToken = window.location.pathname.match(/^\/tv\/([\w-]+)\/?$/)?.[1];
  if (tvToken) {
    return (
      <Suspense fallback={null}>
        <TvPage token={tvToken} />
      </Suspense>
    );
  }

  if (!signedIn) return <LoginScreen onSignedIn={() => setSignedIn(true)} />;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell onSignOut={signOut} />}>
            <Route index element={<DashboardScreen />} />
            <Route path="metas" element={<GoalsScreen />} />
            <Route path="resumo" element={<ReportScreen />} />
            <Route path="vender" element={<PdvScreen />} />
            <Route path="vendas" element={<SalesScreen />} />
            <Route path="vendas/:id" element={<SaleScreen />} />
            <Route path="caixa" element={<CashScreen />} />
            <Route path="produtos" element={<ProductsScreen />} />
            <Route path="estoque" element={<ProductsScreen key="estoque" stockView />} />
            <Route path="validades" element={<ExpiringScreen />} />
            <Route path="insumos/contagem" element={<CountScreen />} />
            <Route path="insumos/perdas" element={<LossesScreen />} />
            <Route path="clientes" element={<CustomersScreen />} />
            <Route path="clientes/:id" element={<CustomerScreen />} />
            <Route path="pagar" element={<PayablesScreen />} />
            <Route path="fiscal" element={<FiscalScreen />} />
            <Route path="configuracoes/lojas" element={<StoresScreen />} />
            <Route path="configuracoes/usuarios" element={<UsersScreen />} />
            <Route path="configuracoes/clube" element={<ClubScreen />} />
            <Route path="configuracoes/categorias" element={<CategoriesScreen />} />
            <Route path="configuracoes/tv" element={<TvScreensScreen />} />
            <Route path="configuracoes/fiscal" element={<FiscalSettingsScreen />} />
            {upcomingItems().map((item) => (
              <Route key={item.path} path={item.path.slice(1)} element={<ComingSoonScreen item={item} />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
