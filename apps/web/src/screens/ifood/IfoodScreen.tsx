import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ORDER_STATUS, formatMoney, type IfoodOrderRow, type IfoodStatus } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Empty, ErrorBox, Loading, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../components/format';

const COR: Record<IfoodOrderRow['status'], string> = { importado: 'bg-emerald-100 text-emerald-800', sem_cadastro: 'bg-red-100 text-red-700', cancelado: 'bg-slate-100 text-slate-600', concluido: 'bg-sky-100 text-sky-800' };
const NOME: Record<IfoodOrderRow['status'], string> = { importado: 'na loja', sem_cadastro: 'sem cadastro', cancelado: 'cancelado', concluido: 'concluído' };

/** Pedidos do iFood: o que chegou, o que virou pedido e venda aqui e o que precisa de ajuste. */
export function IfoodScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ifood'], queryFn: () => api<IfoodStatus>('/ifood'), refetchInterval: 30_000 });
  const refazer = useMutation({ mutationFn: (id: string) => api(`/ifood/orders/${id}/retry`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ifood'] }) });
  const d = q.data;
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="iFood e marketplaces" subtitle="Os pedidos do iFood entram sozinhos na tela de preparo e viram venda no canal iFood, com baixa de estoque. O andamento na tela de preparo é avisado ao iFood." />
      <ErrorBox error={q.error ?? refazer.error} />
      {q.isLoading ? <Loading /> : d && (
        <>
          <div className={`rounded-lg p-4 text-sm ${d.provider === 'off' ? 'bg-amber-50 text-amber-800' : d.lastError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
            {d.provider === 'off' ? (
              <>
                <b>iFood ainda não conectado.</b> Para ligar: no Portal do Desenvolvedor do iFood, crie um aplicativo do tipo "centralizado" para a sua loja e coloque no arquivo <code>.env</code> do servidor as três chaves: <code>IFOOD_CLIENT_ID</code>, <code>IFOOD_CLIENT_SECRET</code> e <code>IFOOD_MERCHANT_ID</code>. Depois rode a atualização.
              </>
            ) : d.lastError ? (
              <><b>Falha ao falar com o iFood:</b> {d.lastError}</>
            ) : (
              <><b>Conectado{d.provider === 'teste' ? ' (simulador)' : ''}</b> · pedidos caem na loja {d.storeName ?? ''}{d.lastPollAt ? ` · última busca ${formatDateTime(d.lastPollAt)}` : ''}</>
            )}
          </div>
          <div className="card overflow-x-auto">
            {!d.orders.length ? <Empty>Nenhum pedido do iFood ainda.</Empty> : (
              <table className="table">
                <thead><tr><th>Pedido</th><th>Itens</th><th className="text-right">No iFood</th><th className="text-right">Aqui</th><th>Situação</th></tr></thead>
                <tbody>
                  {d.orders.map((o) => (
                    <tr key={o.id} className="align-top">
                      <td className="whitespace-nowrap"><div className="font-medium">#{o.displayId} · {o.customerName}</div><div className="text-xs text-ink-soft">{formatDateTime(o.createdAt)} · {o.delivery}</div></td>
                      <td className="text-sm">{o.items.map((i, n) => <div key={n} className={i.matched ? '' : 'text-red-700'}>{i.quantity}× {i.name}{!i.matched && ` (código PDV ${i.code ? `"${i.code}" não existe aqui` : 'vazio'})`}</div>)}</td>
                      <td className="text-right tabular-nums">{formatMoney(o.total)}</td>
                      <td className={`text-right tabular-nums ${o.localTotal != null && Math.abs(o.localTotal - o.total) > 0.009 ? 'text-amber-700' : ''}`}>{o.localTotal == null ? '—' : formatMoney(o.localTotal)}</td>
                      <td className="space-y-1 text-sm">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${COR[o.status]}`}>{NOME[o.status]}</span>
                        {o.orderNumber != null && <div className="text-ink-soft">Pedido {o.orderNumber}{o.orderStatus ? ` · ${(ORDER_STATUS as Record<string, string>)[o.orderStatus] ?? o.orderStatus}` : ''}{o.saleNumber != null ? ` · venda nº ${o.saleNumber}` : ''}</div>}
                        {o.problem && <div className="text-red-700">{o.problem}</div>}
                        {(o.status === 'sem_cadastro' || (o.status === 'importado' && o.problem?.startsWith('Venda não'))) && <button className="text-brand hover:underline" disabled={refazer.isPending} onClick={() => refazer.mutate(o.id)}>Tentar de novo</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card space-y-2 p-4 text-sm text-ink-soft">
            <p><b className="text-ink">Como o sistema reconhece o produto:</b> pelo "código PDV" de cada item no cardápio do iFood, que precisa ser igual ao código (ou ao código de barras) do produto em <Link className="text-brand hover:underline" to="/produtos">Produtos</Link>. Item sem código não vira venda: aparece aqui em vermelho para você corrigir e tentar de novo.</p>
            <p><b className="text-ink">Valores:</b> a venda entra pelos preços do sistema. Se o preço no iFood for diferente, a coluna "Aqui" fica em laranja. A comissão do iFood e o prazo de repasse ficam na forma de pagamento "iFood", em <Link className="text-brand hover:underline" to="/receber">Contas a receber › Taxas e prazos</Link>.</p>
            <p><b className="text-ink">Cancelar:</b> pedido cancelado no iFood é cancelado aqui; se a venda já tinha sido registrada, cancele a venda em Vendas para devolver o estoque. Cancelamento feito pela loja precisa ser feito também no Gestor de Pedidos do iFood.</p>
            <p><b className="text-ink">Outros canais:</b> Mercado Livre, Shopee, Amazon e 99Food ainda não estão ligados. Enquanto isso, registre essas vendas no caixa escolhendo o canal "Marketplace".</p>
          </div>
        </>
      )}
    </div>
  );
}
