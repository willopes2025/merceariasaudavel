import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UTM_PRESETS, slugify, storefrontSettingsSchema, type OriginReport, type StorefrontSettings } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney } from '../../components/format';
import { Qr } from '../../shop/parts';

const ORIGIN_LABEL: Record<string, string> = { '(direto)': 'Direto (sem origem)', instagram: 'Instagram', facebook: 'Facebook/Instagram Ads', google: 'Google', whatsapp: 'WhatsApp', panfleto: 'Panfleto/QR' };

/** Loja online: link da vitrine, links rastreados para cada divulgação, Pixel/GA4 e vendas por origem. */
export function StorefrontScreen() {
  const settings = useQuery({ queryKey: ['storefront-settings'], queryFn: () => api<StorefrontSettings>('/storefront/settings'), enabled: can('settings.manage') });
  const url = settings.data?.url ?? `${window.location.origin}/loja`;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Loja online" subtitle="Vitrine aberta com todos os produtos do app, página de cada produto para o Google e os anúncios, e o relatório de onde vêm as vendas." />
      <section className="card flex flex-wrap items-center gap-4 p-4">
        <Qr value={url} size={112} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-soft">Endereço da loja</p>
          <p className="truncate text-lg font-semibold">{url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="btn-primary px-3 py-1.5" href={url} target="_blank" rel="noreferrer">
              Abrir a loja
            </a>
            <button className="btn-ghost px-3 py-1.5" onClick={() => navigator.clipboard?.writeText(url)}>
              Copiar
            </button>
          </div>
        </div>
      </section>
      <LinkBuilder url={url} />
      {can('report.view') && <OriginsReport />}
      {can('settings.manage') && (settings.isLoading ? <Loading /> : settings.data && <SettingsCard data={settings.data} />)}
    </div>
  );
}

function LinkBuilder({ url }: { url: string }) {
  const [preset, setPreset] = useState<string>(UTM_PRESETS[0].key);
  const [campaign, setCampaign] = useState('');
  const p = UTM_PRESETS.find((x) => x.key === preset)!;
  const params = new URLSearchParams({ utm_source: p.source, utm_medium: p.medium });
  if (campaign.trim()) params.set('utm_campaign', slugify(campaign));
  const link = `${url}?${params.toString()}`;
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Link para cada divulgação</h2>
      <p className="mb-3 text-sm text-ink-soft">Use um link diferente em cada lugar: o relatório abaixo mostra quantos pedidos, vendas e cadastros vieram de cada um.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Onde vai divulgar">
          <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {UTM_PRESETS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nome da campanha (opcional)" hint="Ex.: Black Friday, Whey novembro">
          <input className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="min-w-0 flex-1 break-all rounded bg-slate-100 px-2 py-1.5 text-sm">{link}</code>
        <button className="btn-primary px-3 py-1.5" onClick={() => navigator.clipboard?.writeText(link)}>
          Copiar link
        </button>
        {p.key === 'panfleto' && <Qr value={link} size={96} />}
      </div>
      <p className="mt-2 text-xs text-ink-soft">Anúncios do Google e do Meta também são reconhecidos pelo clique (gclid/fbclid), mesmo sem estes parâmetros.</p>
    </section>
  );
}

function OriginsReport() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['storefront-origins', days], queryFn: () => api<OriginReport>(`/storefront/origins?days=${days}`) });
  const r = q.data;
  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
        <h2 className="font-semibold">De onde vêm as vendas do app e da loja online</h2>
        <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              Últimos {d} dias
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? (
        <Loading />
      ) : !r?.rows.length ? (
        <Empty>Nenhum pedido pelo app ou pela loja online no período.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Origem</th>
              <th>Meio</th>
              <th>Campanha</th>
              <th className="text-right">Cadastros</th>
              <th className="text-right">Pedidos</th>
              <th className="text-right">Pagos</th>
              <th className="text-right">Vendido</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={`${x.source}|${x.medium}|${x.campaign}`}>
                <td className="font-medium">{ORIGIN_LABEL[x.source] ?? x.source}</td>
                <td>{x.medium || '—'}</td>
                <td>{x.campaign || '—'}</td>
                <td className="text-right">{x.newCustomers}</td>
                <td className="text-right">{x.orders}</td>
                <td className="text-right">{x.paidOrders}</td>
                <td className="text-right font-semibold">{formatMoney(x.revenue)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 font-semibold">
              <td colSpan={3}>Total</td>
              <td className="text-right">{r.totals.newCustomers}</td>
              <td className="text-right">{r.totals.orders}</td>
              <td className="text-right">{r.totals.paidOrders}</td>
              <td className="text-right">{formatMoney(r.totals.revenue)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <p className="p-4 pt-2 text-xs text-ink-soft">Vendido = valor dos produtos dos pedidos pagos (sem a taxa de entrega). A origem fica guardada por 30 dias depois do clique.</p>
    </section>
  );
}

function SettingsCard({ data }: { data: StorefrontSettings }) {
  const client = useQueryClient();
  const [f, setF] = useState({ shopDescription: data.shopDescription ?? '', metaPixelId: data.metaPixelId ?? '', ga4Id: data.ga4Id ?? '' });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setF({ shopDescription: data.shopDescription ?? '', metaPixelId: data.metaPixelId ?? '', ga4Id: data.ga4Id ?? '' }), [data]);
  const save = useMutation({
    mutationFn: (body: unknown) => api<StorefrontSettings>('/storefront/settings', { method: 'PUT', json: body }),
    onSuccess: (s) => {
      client.setQueryData(['storefront-settings'], s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: setError,
  });
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold">Google e anúncios</h2>
      <Field label="Descrição da loja" hint="Aparece no Google e quando o link é compartilhado no WhatsApp/Instagram. Até 300 letras.">
        <textarea className="input" rows={2} maxLength={300} value={f.shopDescription} onChange={(e) => setF({ ...f, shopDescription: e.target.value })} placeholder="Suplementos, produtos Pacco, shakes e sorvetes saudáveis em Natal. Compre online e retire na loja." />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID do Pixel do Meta" hint="Gerenciador de Eventos do Meta › Fontes de dados (só números).">
          <input className="input" inputMode="numeric" value={f.metaPixelId} onChange={(e) => setF({ ...f, metaPixelId: e.target.value })} />
        </Field>
        <Field label="ID do Google Analytics 4" hint="Analytics › Administrador › Fluxos de dados (G-XXXXXXX).">
          <input className="input uppercase" value={f.ga4Id} onChange={(e) => setF({ ...f, ga4Id: e.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-ink-soft">Com os IDs, a loja e o app mandam: visita, produto visto, adicionou ao carrinho, cadastro, início da compra e compra paga. Só depois de a cliente aceitar os cookies.</p>
      <ErrorBox error={error} />
      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => {
            const parsed = storefrontSettingsSchema.safeParse(f);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(null);
            save.mutate(parsed.data);
          }}
        >
          Salvar
        </button>
        {saved && <span className="text-sm text-emerald-700">Salvo ✓</span>}
      </div>
    </section>
  );
}
