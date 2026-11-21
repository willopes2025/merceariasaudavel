import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnlineSettings } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { ErrorBox, Loading, PageHeader } from '../../components/ui';

/** Pagamento online: liga Pix/cartão no app e Pix no totem; mostra se o Mercado Pago está ligado no servidor. */
export function OnlinePaymentScreen() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ['payments-settings'], queryFn: () => api<OnlineSettings>('/payments/settings') });
  const [f, setF] = useState({ onlinePix: false, onlineCard: false, onlineTotem: false });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (q.data) setF({ onlinePix: q.data.onlinePix, onlineCard: q.data.onlineCard, onlineTotem: q.data.onlineTotem });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api<OnlineSettings>('/payments/settings', { method: 'PUT', json: f }),
    onSuccess: (s) => {
      client.setQueryData(['payments-settings'], s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });
  if (q.isLoading) return <Loading />;
  const s = q.data;
  const ready = Boolean(s?.provider);
  const toggle = (k: keyof typeof f, label: string, hint: string) => (
    <label className={`flex items-start gap-3 rounded-xl border p-4 ${f[k] ? 'border-brand bg-brand-soft' : 'border-slate-200'} ${ready ? '' : 'opacity-60'}`}>
      <input type="checkbox" className="mt-1 h-5 w-5 accent-brand" disabled={!ready} checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="text-sm text-ink-soft">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Pagamento no app e no totem" subtitle="A cliente paga com Pix ou cartão pelo celular (ou Pix no totem) e o pedido já cai pago na tela de preparo, sem passar no caixa. A venda é registrada sozinha no caixa aberto." />
      <ErrorBox error={q.error} />
      <section className="card p-4">
        <h2 className="font-semibold">Mercado Pago</h2>
        {s?.provider === 'mercadopago' ? (
          <p className="mt-1 text-sm">
            <span className="badge bg-emerald-100 text-emerald-800">Ligado</span>
            {s.testMode && <span className="badge ml-2 bg-amber-100 text-amber-800">Chave de teste</span>}
            {!s.webhookSigned && <span className="badge ml-2 bg-slate-100 text-ink-soft">Aviso sem assinatura</span>}
          </p>
        ) : s?.provider === 'teste' ? (
          <p className="mt-1 text-sm">
            <span className="badge bg-amber-100 text-amber-800">Modo de teste</span> Nada é cobrado. Em Caixa › "Pedidos para cobrar" aparece "Simular pagamento".
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-800">Ainda não ligado no servidor.</p>
        )}
        {s?.webhookUrl && (
          <div className="mt-3 text-sm">
            <p className="font-medium">Endereço do aviso (Webhooks no Mercado Pago, evento "Pagamentos"):</p>
            <div className="mt-1 flex gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-slate-100 px-2 py-1.5">{s.webhookUrl}</code>
              <button className="btn-ghost px-3 py-1" onClick={() => navigator.clipboard?.writeText(s.webhookUrl!)}>
                Copiar
              </button>
            </div>
          </div>
        )}
        {s?.provider !== 'mercadopago' && (
          <details className="mt-3 text-sm" open={!ready}>
            <summary className="cursor-pointer font-medium text-brand">Como ligar</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
              <li>No Mercado Pago da loja: Seu negócio › Configurações › Credenciais (ou mercadopago.com.br/developers › Suas integrações › Criar aplicação, tipo "Pagamentos online").</li>
              <li>Copie o <b>Access Token de produção</b> (começa com APP_USR-).</li>
              <li>Em Webhooks, cole o endereço https://mercearia.wideic.com/v1/payments/webhook/mercadopago, marque "Pagamentos" e copie a <b>assinatura secreta</b>.</li>
              <li>
                No servidor, acrescente no arquivo <code>/opt/mercearia/.env</code>:
                <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-xs text-ink">{'MP_ACCESS_TOKEN=APP_USR-...\nMP_WEBHOOK_SECRET=...'}</pre>
                e rode <code>./scripts/atualizar.sh</code>.
              </li>
            </ol>
          </details>
        )}
      </section>
      <section className="space-y-2">
        {toggle('onlinePix', 'Pix no app', 'QR code e copia e cola na tela do pedido. Confirma em segundos.')}
        {toggle('onlineCard', 'Cartão no app', 'Abre a página segura do Mercado Pago (crédito ou débito virtual). O cartão não passa pela loja.')}
        {toggle('onlineTotem', 'Pix no totem', 'Depois do pedido, o totem mostra o QR para pagar com o celular. Quem preferir paga no caixa.')}
      </section>
      <ErrorBox error={save.error} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          Salvar
        </button>
        {saved && <span className="text-sm text-emerald-700">Salvo ✓</span>}
      </div>
      <section className="card p-4 text-sm text-ink-soft">
        <h2 className="mb-1 font-semibold text-ink">Como funciona</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Só gera pagamento com o caixa da loja aberto. Se o caixa fechar antes de o pagamento cair, o pedido aparece em "Pedidos para cobrar" com o botão "Registrar pagamento online".</li>
          <li>A venda entra no caixa como "Pix online" ou "Cartão online", com cashback, cupom e nota fiscal como no balcão.</li>
          <li>Cancelar a venda (ou o pedido pago) devolve o dinheiro para a cliente pelo Mercado Pago.</li>
          <li>Se o pagamento cair num pedido já cobrado no caixa ou cancelado, o valor é devolvido sozinho.</li>
        </ul>
      </section>
    </div>
  );
}
