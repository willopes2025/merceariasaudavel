import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_TYPES,
  WEEKDAYS,
  addDays,
  campaignSchema,
  couponSummary,
  todayBR,
  type Campaign,
  type CampaignAudience,
  type CampaignType,
  type Category,
  type Page,
  type Product,
} from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney } from '../../components/format';

const day = (iso: string) => iso.split('-').reverse().join('/');

function status(c: Campaign): { label: string; tone: string } {
  const today = todayBR();
  if (!c.active) return { label: 'Desligada', tone: 'bg-slate-100 text-ink-soft' };
  if (c.endsOn < today) return { label: 'Encerrada', tone: 'bg-slate-100 text-ink-soft' };
  if (c.startsOn > today) return { label: 'Agendada', tone: 'bg-sky-100 text-sky-800' };
  if (!c.runningNow) return { label: 'Fora do dia', tone: 'bg-amber-100 text-amber-800' };
  return { label: 'Rodando', tone: 'bg-brand-soft text-brand' };
}

function what(c: Campaign): string {
  if (c.type === 'cupom') return `${c.code} · ${couponSummary(c)}`;
  if (c.type === 'cashback') return `+${c.extraCashbackPct?.toLocaleString('pt-BR')}% de cashback ${c.scope === 'tudo' ? 'em tudo' : c.scope === 'categorias' ? `em ${c.categories.map((x) => x.name).join(', ')}` : `em ${c.products.length} produto(s)`}`;
  return c.products.map((p) => `${p.name} por ${formatMoney(p.promoPrice ?? 0)}`).join(' · ');
}

/** Campanhas: cupom, cashback turbinado e oferta, com o resultado de cada uma. */
export function CampaignsScreen() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['campaigns'], queryFn: () => api<Campaign[]>('/campaigns') });
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (c: Campaign) => api(`/campaigns/${c.id}`, { method: 'PUT', json: toInput({ ...c, active: !c.active }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['campaigns'] }),
  });
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Campanhas"
        subtitle="Cupom de desconto, cashback turbinado e ofertas. O caixa, o app e o totem aplicam sozinhos."
        action={
          <button className="btn-primary" onClick={() => setEditing('new')}>
            Nova campanha
          </button>
        }
      />
      <ErrorBox error={list.error ?? toggle.error} />
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <div className="card">
          <Empty>
            <p className="font-medium text-ink">Nenhuma campanha ainda</p>
            <p>Ideias: cupom BEMVINDO10 para o primeiro pedido, cashback em dobro na terça, oferta da semana nos shakes, cupom de aniversário.</p>
          </Empty>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((c) => {
            const st = status(c);
            return (
              <article key={c.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{CAMPAIGN_TYPES[c.type]}</p>
                    <h2 className="font-semibold">{c.name}</h2>
                  </div>
                  <span className={`badge ${st.tone}`}>{st.label}</span>
                </div>
                <p className="mt-1 text-sm">{what(c)}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {day(c.startsOn)} a {day(c.endsOn)}
                  {c.weekdays.length ? ` · ${c.weekdays.map((d) => WEEKDAYS[d]).join(', ')}` : ''} · {CAMPAIGN_AUDIENCES[c.audience]}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-center text-xs">
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{c.stats.sales}</p>
                    vendas
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(c.stats.revenue)}</p>
                    faturado
                  </div>
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(c.type === 'cashback' ? c.stats.cashback : c.stats.discount)}</p>
                    {c.type === 'cashback' ? 'cashback extra' : c.type === 'cupom' ? 'de desconto' : 'economia'}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn-ghost px-3 py-1" onClick={() => setEditing(c)}>
                    Editar
                  </button>
                  <button className="btn-ghost px-3 py-1" disabled={toggle.isPending} onClick={() => toggle.mutate(c)}>
                    {c.active ? 'Desligar' : 'Ligar'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && (
        <CampaignForm
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            client.invalidateQueries({ queryKey: ['campaigns'] });
          }}
        />
      )}
    </div>
  );
}

function toInput(c: Campaign) {
  return {
    name: c.name,
    type: c.type,
    active: c.active,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    weekdays: c.weekdays,
    audience: c.audience,
    description: c.description,
    code: c.code,
    discountPct: c.discountPct,
    discountAmount: c.discountAmount,
    minPurchase: c.minPurchase,
    maxUses: c.maxUses,
    maxPerCustomer: c.maxPerCustomer,
    extraCashbackPct: c.extraCashbackPct,
    scope: c.scope,
    categoryIds: c.categories.map((x) => x.id),
    products: c.products.map((p) => ({ productId: p.productId, promoPrice: p.promoPrice })),
  };
}

interface Form {
  name: string;
  type: CampaignType;
  active: boolean;
  startsOn: string;
  endsOn: string;
  weekdays: number[];
  audience: CampaignAudience;
  description: string;
  code: string;
  off: 'pct' | 'amount';
  discount: string;
  minPurchase: string;
  maxUses: string;
  maxPerCustomer: string;
  extraCashbackPct: string;
  scope: 'tudo' | 'categorias' | 'produtos';
  categoryIds: string[];
  products: Array<{ productId: string; name: string; price: number; memberPrice: number | null; promoPrice: string }>;
}

function CampaignForm({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const today = todayBR();
  const [f, setF] = useState<Form>(() =>
    campaign
      ? {
          name: campaign.name,
          type: campaign.type,
          active: campaign.active,
          startsOn: campaign.startsOn,
          endsOn: campaign.endsOn,
          weekdays: campaign.weekdays,
          audience: campaign.audience,
          description: campaign.description ?? '',
          code: campaign.code ?? '',
          off: campaign.discountAmount != null ? 'amount' : 'pct',
          discount: String(campaign.discountAmount ?? campaign.discountPct ?? '').replace('.', ','),
          minPurchase: campaign.minPurchase ? String(campaign.minPurchase).replace('.', ',') : '',
          maxUses: campaign.maxUses ? String(campaign.maxUses) : '',
          maxPerCustomer: campaign.maxPerCustomer ? String(campaign.maxPerCustomer) : '',
          extraCashbackPct: campaign.extraCashbackPct ? String(campaign.extraCashbackPct).replace('.', ',') : '',
          scope: campaign.scope,
          categoryIds: campaign.categories.map((x) => x.id),
          products: campaign.products.map((p) => ({ ...p, promoPrice: p.promoPrice != null ? String(p.promoPrice).replace('.', ',') : '' })),
        }
      : { name: '', type: 'cupom', active: true, startsOn: today, endsOn: addDays(today, 30), weekdays: [], audience: 'todos', description: '', code: '', off: 'pct', discount: '', minPurchase: '', maxUses: '', maxPerCustomer: '1', extraCashbackPct: '', scope: 'tudo', categoryIds: [], products: [] },
  );
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const found = useQuery({ queryKey: ['campaign-product-search', q], queryFn: () => api<Page<Product>>(`/products?q=${encodeURIComponent(q)}&pageSize=10`), enabled: q.trim().length >= 2 });
  const save = useMutation({
    mutationFn: (body: unknown) => (campaign ? api(`/campaigns/${campaign.id}`, { method: 'PUT', json: body }) : api('/campaigns', { method: 'POST', json: body })),
    onSuccess: onSaved,
    onError: setError,
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const needsProducts = f.type === 'oferta' || (f.type === 'cashback' && f.scope === 'produtos');

  function submit() {
    const body = {
      name: f.name,
      type: f.type,
      active: f.active,
      startsOn: f.startsOn,
      endsOn: f.endsOn,
      weekdays: f.weekdays,
      audience: f.type !== 'cupom' && f.audience === 'aniversariantes' ? 'todos' : f.audience,
      description: f.description || null,
      code: f.type === 'cupom' ? f.code : null,
      discountPct: f.type === 'cupom' && f.off === 'pct' ? f.discount : null,
      discountAmount: f.type === 'cupom' && f.off === 'amount' ? f.discount : null,
      minPurchase: f.minPurchase || 0,
      maxUses: f.maxUses || null,
      maxPerCustomer: f.maxPerCustomer || null,
      extraCashbackPct: f.type === 'cashback' ? f.extraCashbackPct : null,
      scope: f.scope,
      categoryIds: f.type === 'cashback' && f.scope === 'categorias' ? f.categoryIds : [],
      products: needsProducts ? f.products.map((p) => ({ productId: p.productId, promoPrice: f.type === 'oferta' ? p.promoPrice : null })) : [],
    };
    const parsed = campaignSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(null);
    save.mutate(parsed.data);
  }

  return (
    <Drawer title={campaign ? 'Editar campanha' : 'Nova campanha'} onClose={onClose} wide>
      <div className="space-y-4">
        {!campaign && (
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(CAMPAIGN_TYPES) as CampaignType[]).map((t) => (
              <button key={t} onClick={() => set('type', t)} className={`rounded-lg border p-3 text-left text-sm ${f.type === t ? 'border-brand bg-brand-soft font-semibold text-brand-dark' : 'border-slate-200'}`}>
                {CAMPAIGN_TYPES[t]}
                <span className="mt-1 block text-xs font-normal text-ink-soft">{t === 'cupom' ? 'Código com % ou R$ e limites' : t === 'cashback' ? '+% de cashback no período' : 'Preço promocional por produto'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome">
            <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={f.type === 'cupom' ? 'Boas-vindas' : f.type === 'cashback' ? 'Terça do cashback em dobro' : 'Oferta da semana'} />
          </Field>
          <Field label="Quem pode usar">
            <select className="input" value={f.audience} onChange={(e) => set('audience', e.target.value as CampaignAudience)}>
              <option value="todos">Todo mundo</option>
              <option value="membros">Só membros</option>
              {f.type === 'cupom' && <option value="aniversariantes">Aniversariantes do mês</option>}
            </select>
          </Field>
          <Field label="Começa">
            <input className="input" type="date" value={f.startsOn} onChange={(e) => set('startsOn', e.target.value)} />
          </Field>
          <Field label="Termina">
            <input className="input" type="date" value={f.endsOn} onChange={(e) => set('endsOn', e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Dias da semana {f.weekdays.length ? '' : <span className="font-normal text-ink-soft">(todos)</span>}</p>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((w, i) => (
              <button key={w} onClick={() => set('weekdays', f.weekdays.includes(i) ? f.weekdays.filter((x) => x !== i) : [...f.weekdays, i])} className={`rounded-full border px-3 py-1 text-sm ${f.weekdays.includes(i) ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>
                {w}
              </button>
            ))}
          </div>
        </div>

        {f.type === 'cupom' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código" hint="O que a cliente fala no caixa. Letras, números ou hífen.">
              <input className="input uppercase" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="BEMVINDO10" maxLength={20} />
            </Field>
            <Field label="Desconto">
              <div className="flex gap-2">
                <select className="input w-24" value={f.off} onChange={(e) => set('off', e.target.value as Form['off'])}>
                  <option value="pct">%</option>
                  <option value="amount">R$</option>
                </select>
                <input className="input" inputMode="decimal" value={f.discount} onChange={(e) => set('discount', e.target.value)} placeholder={f.off === 'pct' ? '10' : '5,00'} />
              </div>
            </Field>
            <Field label="Compra mínima (R$)">
              <input className="input" inputMode="decimal" value={f.minPurchase} onChange={(e) => set('minPurchase', e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Usos por cliente" hint="Vazio = sem limite. Aniversário: 1 por ano.">
              <input className="input" inputMode="numeric" value={f.maxPerCustomer} onChange={(e) => set('maxPerCustomer', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="Usos no total" hint="Vazio = sem limite (ex.: os 50 primeiros).">
              <input className="input" inputMode="numeric" value={f.maxUses} onChange={(e) => set('maxUses', e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
        )}

        {f.type === 'cashback' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cashback a mais (%)" hint="Soma ao cashback do clube. Dobro de 2% = +2.">
              <input className="input" inputMode="decimal" value={f.extraCashbackPct} onChange={(e) => set('extraCashbackPct', e.target.value)} placeholder="2" />
            </Field>
            <Field label="Vale em">
              <select className="input" value={f.scope} onChange={(e) => set('scope', e.target.value as Form['scope'])}>
                <option value="tudo">Tudo</option>
                <option value="categorias">Algumas categorias</option>
                <option value="produtos">Alguns produtos</option>
              </select>
            </Field>
            {f.scope === 'categorias' && (
              <div className="flex flex-wrap gap-1 sm:col-span-2">
                {(categories.data ?? []).filter((c) => c.active).map((c) => (
                  <button key={c.id} onClick={() => set('categoryIds', f.categoryIds.includes(c.id) ? f.categoryIds.filter((x) => x !== c.id) : [...f.categoryIds, c.id])} className={`rounded-full border px-3 py-1 text-sm ${f.categoryIds.includes(c.id) ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {needsProducts && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium">{f.type === 'oferta' ? 'Produtos e preço promocional' : 'Produtos'}</p>
            {f.products.map((p, i) => (
              <div key={p.productId} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {p.name}
                  <span className="ml-2 text-xs text-ink-soft">
                    normal {formatMoney(p.price)}
                    {p.memberPrice != null ? ` · membro ${formatMoney(p.memberPrice)}` : ''}
                  </span>
                </span>
                {f.type === 'oferta' && <input className="input w-28 text-right" inputMode="decimal" value={p.promoPrice} onChange={(e) => set('products', f.products.map((x, k) => (k === i ? { ...x, promoPrice: e.target.value } : x)))} placeholder="R$" />}
                <button className="text-xs text-red-600" onClick={() => set('products', f.products.filter((_, k) => k !== i))}>
                  Tirar
                </button>
              </div>
            ))}
            <input className="input" placeholder="Buscar produto para acrescentar" value={q} onChange={(e) => setQ(e.target.value)} />
            {found.data?.items
              .filter((p) => p.kind !== 'insumo' && !f.products.some((x) => x.productId === p.id))
              .map((p) => (
                <button key={p.id} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => { set('products', [...f.products, { productId: p.id, name: p.name, price: p.price, memberPrice: p.memberPrice, promoPrice: '' }]); setQ(''); }}>
                  + {p.name} <span className="text-xs text-ink-soft">({formatMoney(p.price)})</span>
                </button>
              ))}
            {f.type === 'oferta' && <p className="text-xs text-ink-soft">A oferta só vale quando o preço promocional é menor do que a cliente já pagaria (normal ou de membro).</p>}
          </div>
        )}

        {f.type !== 'cupom' && (
          <Field label="Texto no app (opcional)">
            <input className="input" maxLength={160} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Toda terça o cashback dobra nos shakes!" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
          Ligada
        </label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={save.isPending} onClick={submit}>
            Salvar campanha
          </button>
        </div>
      </div>
    </Drawer>
  );
}
