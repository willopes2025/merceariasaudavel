import { Suspense, lazy, useState, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, session, whenSessionExpires } from './lib/api';
import { upcomingItems } from './lib/nav';
import { AppShell } from './components/AppShell';
import { LoginScreen } from './screens/LoginScreen';
import { HomeScreen } from './screens/HomeScreen';
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
const FiscalSettingsScreen = screen(() => import('./screens/settings/FiscalSettingsScreen'), (m) => m.FiscalSettingsScreen);
const FiscalScreen = screen(() => import('./screens/fiscal/FiscalScreen'), (m) => m.FiscalScreen);
const OperationsScreen = screen(() => import('./screens/settings/OperationsScreen'), (m) => m.OperationsScreen);
const UsersScreen = screen(() => import('./screens/settings/UsersScreen'), (m) => m.UsersScreen);
const OriginsScreen = screen(() => import('./screens/settings/LookupScreens'), (m) => m.OriginsScreen);
const InsurancePlansScreen = screen(() => import('./screens/settings/LookupScreens'), (m) => m.InsurancePlansScreen);
const DoctorsScreen = screen(() => import('./screens/settings/LookupScreens'), (m) => m.DoctorsScreen);
const CustomersScreen = screen(() => import('./screens/customers/CustomersScreen'), (m) => m.CustomersScreen);
const CustomerScreen = screen(() => import('./screens/customers/CustomerScreen'), (m) => m.CustomerScreen);
const EventsScreen = screen(() => import('./screens/seven/EventsScreen'), (m) => m.EventsScreen);
const EventScreen = screen(() => import('./screens/seven/EventScreen'), (m) => m.EventScreen);
const DayPanelIndex = screen(() => import('./screens/seven/DayPanelIndex'), (m) => m.DayPanelIndex);
const InstitutionsScreen = screen(() => import('./screens/seven/InstitutionsScreen'), (m) => m.InstitutionsScreen);
const PublicEventPage = screen(() => import('./screens/seven/PublicEventPage'), (m) => m.PublicEventPage);
const ImportScreen = screen(() => import('./screens/settings/ImportScreen'), (m) => m.ImportScreen);
const ServiceOrdersScreen = screen(() => import('./screens/os/ServiceOrdersScreen'), (m) => m.ServiceOrdersScreen);
const ServiceOrderScreen = screen(() => import('./screens/os/ServiceOrderScreen'), (m) => m.ServiceOrderScreen);
const ServiceOrderFormScreen = screen(() => import('./screens/os/ServiceOrderFormScreen'), (m) => m.ServiceOrderFormScreen);
const BoardScreen = screen(() => import('./screens/os/BoardScreen'), (m) => m.BoardScreen);
const PrescriptionsScreen = screen(() => import('./screens/customers/PrescriptionsScreen'), (m) => m.PrescriptionsScreen);
const CashScreen = screen(() => import('./screens/cash/CashScreen'), (m) => m.CashScreen);
const ReceivablesScreen = screen(() => import('./screens/finance/ReceivablesScreen'), (m) => m.ReceivablesScreen);
const ProductsScreen = screen(() => import('./screens/products/ProductsScreen'), (m) => m.ProductsScreen);
const PayablesScreen = screen(() => import('./screens/finance/PayablesScreen'), (m) => m.PayablesScreen);
const ReportScreen = screen(() => import('./screens/finance/ReportScreen'), (m) => m.ReportScreen);
const QuotesScreen = screen(() => import('./screens/quotes/QuotesScreen'), (m) => m.QuotesScreen);
const QuoteScreen = screen(() => import('./screens/quotes/QuoteScreen'), (m) => m.QuoteScreen);
const QuoteFormScreen = screen(() => import('./screens/quotes/QuoteFormScreen'), (m) => m.QuoteFormScreen);
const OsStagesScreen = screen(() => import('./screens/settings/OsStagesScreen'), (m) => m.OsStagesScreen);
const CustomerFormScreen = screen(() => import('./screens/customers/CustomerFormScreen'), (m) => m.CustomerFormScreen);

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

  // Página pública de inscrição do Programa Seven: abre sem login.
  const publicSlug = window.location.pathname.match(/^\/acao\/([a-z0-9-]+)\/?$/)?.[1];
  if (publicSlug) {
    return (
      <Suspense fallback={null}>
        <PublicEventPage slug={publicSlug} />
      </Suspense>
    );
  }

  if (!signedIn) return <LoginScreen onSignedIn={() => setSignedIn(true)} />;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell onSignOut={signOut} />}>
            <Route index element={<HomeScreen />} />
            <Route path="configuracoes/lojas" element={<StoresScreen />} />
            <Route path="configuracoes/operacoes" element={<OperationsScreen />} />
            <Route path="configuracoes/usuarios" element={<UsersScreen />} />
            <Route path="configuracoes/origens" element={<OriginsScreen />} />
            <Route path="configuracoes/convenios" element={<InsurancePlansScreen />} />
            <Route path="configuracoes/medicos" element={<DoctorsScreen />} />
            <Route path="configuracoes/importar" element={<ImportScreen />} />
            <Route path="configuracoes/etapas-os" element={<OsStagesScreen />} />
            <Route path="configuracoes/fiscal" element={<FiscalSettingsScreen />} />
            <Route path="fiscal" element={<FiscalScreen />} />
            <Route path="caixa" element={<CashScreen />} />
            <Route path="receber" element={<ReceivablesScreen />} />
            <Route path="cobranca" element={<ReceivablesScreen key="cobranca" initial="overdue" />} />
            <Route path="produtos" element={<ProductsScreen />} />
            <Route path="estoque" element={<ProductsScreen key="estoque" stockView />} />
            <Route path="pagar" element={<PayablesScreen />} />
            <Route path="fluxo" element={<ReportScreen />} />
            <Route path="receitas" element={<PrescriptionsScreen />} />
            <Route path="orcamentos" element={<QuotesScreen />} />
            <Route path="orcamentos/novo" element={<QuoteFormScreen />} />
            <Route path="orcamentos/:id" element={<QuoteScreen />} />
            <Route path="orcamentos/:id/editar" element={<QuoteFormScreen key="editar" />} />
            <Route path="os" element={<ServiceOrdersScreen />} />
            <Route path="os/consertos" element={<ServiceOrdersScreen key="consertos" kind="conserto" />} />
            <Route path="os/etapas" element={<BoardScreen />} />
            <Route path="os/nova" element={<ServiceOrderFormScreen />} />
            <Route path="os/:id" element={<ServiceOrderScreen />} />
            <Route path="os/:id/editar" element={<ServiceOrderFormScreen key="editar" />} />
            <Route path="seven/eventos" element={<EventsScreen />} />
            <Route path="seven/eventos/:id" element={<EventScreen />} />
            <Route path="seven/eventos/:id/painel" element={<EventScreen key="painel" initialTab="painel" />} />
            <Route path="seven/painel-do-dia" element={<DayPanelIndex />} />
            <Route path="seven/instituicoes" element={<InstitutionsScreen />} />
            <Route path="clientes" element={<CustomersScreen />} />
            <Route path="clientes/novo" element={<CustomerFormScreen />} />
            <Route path="clientes/:id" element={<CustomerScreen />} />
            <Route path="clientes/:id/editar" element={<CustomerFormScreen key="editar" />} />
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
