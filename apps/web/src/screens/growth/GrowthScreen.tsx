import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fillMessage,
  formatPhone,
  whatsappLink,
  type BirthdayRow,
  type ContactKind,
  type GrowthSummary,
  type LapsedRow,
  type RepurchaseRow,
  type Store,
} from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney } from '../../components/format';

type Tab = 'recompra' | 'sumidas' | 'aniversarios';
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR');

/**
 * Recompra e relacionamento: quem deve estar repondo um produto, quem sumiu
 * e quem faz aniversário. O botão do WhatsApp abre a conversa com a mensagem
 * pronta e marca o contato (ninguém recebe duas vezes).
 */
export function GrowthScreen() {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('recompra');
  const [ahead, setAhead] = useState(7);
  const [days, setDays] = useState(45);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [editing, setEditing] = useState(false);
  const summary = useQuery({ queryKey: ['growth-summary'], queryFn: () => api<GrowthSummary>('/growth/summary') });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const repurchase = useQuery({ queryKey: ['growth-repurchase', ahead], queryFn: () => api<RepurchaseRow[]>(`/growth/repurchase?ahead=${ahead}`), enabled: tab === 'recompra' });
  const lapsed = useQuery({ queryKey: ['growth-lapsed', days], queryFn: () => api<LapsedRow[]>(`/growth/lapsed?days=${days}`), enabled: tab === 'sumidas' });
  const birthdays = useQuery({ queryKey: ['growth-birthdays', month], queryFn: () => api<BirthdayRow[]>(`/growth/birthdays?month=${month}`), enabled: tab === 'aniversarios' });
  const contact = useMutation({
    mutationFn: (body: { customerId: string; productId?: string | null; kind: ContactKind }) => api('/growth/contacts', { method: 'POST', json: body }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['growth-repurchase'] });
      client.invalidateQueries({ queryKey: ['growth-lapsed'] });
      client.invalidateQueries({ queryKey: ['growth-birthdays'] });
      client.invalidateQueries({ queryKey: ['growth-summary'] });
    },
  });

  const s = summary.data;
  const store = stores.data?.find((x) => x.active)?.name ?? 'Mercearia Saudável';
  const vars = { loja: store, app: `${window.location.origin}/app`, cupom: s?.birthdayCoupon?.code ?? '' };
  const send = (phone: string, text: string, body: { customerId: string; productId?: string | null; kind: ContactKind }) => {
    window.open(whatsappLink(phone, text), '_blank', 'noopener');
    contact.mutate(body);
  };
  const tabs: Array<[Tab, string, number | undefined]> = [
    ['recompra', 'Hora de repor', s?.repurchaseDue],
    ['sumidas', 'Clientes sumidas', s?.lapsed],
    ['aniversarios', 'Aniversariantes', s?.birthdays],
  ];

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Recompra e relacionamento"
        subtitle="Mande a mensagem certa na hora certa. O WhatsApp abre com o texto pronto; o contato fica marcado."
        action={
          can('campaign.manage') && (
            <button className="btn-ghost" onClick={() => setEditing(true)}>
              Mensagens
            </button>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        {tabs.map(([key, label, n]) => (
          <button key={key} onClick={() => setTab(key)} className={`rounded-full border px-4 py-2 text-sm font-medium ${tab === key ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}>
            {label}
            {n ? <span className={`ml-2 rounded-full px-2 text-xs ${tab === key ? 'bg-white/20' : 'bg-brand-soft text-brand'}`}>{n}</span> : null}
          </button>
        ))}
      </div>
      <ErrorBox error={contact.error} />

      {tab === 'recompra' && (
        <section className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3 text-sm">
            <p className="text-ink-soft">Pelo ritmo de cada cliente (ou pela duração do produto, cadastrada em Produtos). Atrasadas primeiro.</p>
            <label className="flex items-center gap-2">
              Vence nos próximos
              <select className="input w-auto" value={ahead} onChange={(e) => setAhead(Number(e.target.value))}>
                {[0, 3, 7, 15].map((n) => (
                  <option key={n} value={n}>
                    {n} dias
                  </option>
                ))}
              </select>
            </label>
          </div>
          {repurchase.isLoading ? (
            <Loading />
          ) : !repurchase.data?.length ? (
            <Empty><p className="font-medium text-ink">Ninguém para repor agora</p><p>Aparece aqui quem compra o mesmo produto de tempos em tempos (ou produto com duração cadastrada).</p></Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Produto</th>
                  <th>Última compra</th>
                  <th>Repor em</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {repurchase.data.map((r) => (
                  <tr key={`${r.customerId}-${r.productId}`} className={r.lastContactAt ? 'opacity-60' : ''}>
                    <td>
                      <p className="font-medium">{r.customerName}</p>
                      <p className="text-xs text-ink-soft">{r.phone ? formatPhone(r.phone) : 'sem celular'}</p>
                    </td>
                    <td>
                      {r.productName}
                      <p className="text-xs text-ink-soft">
                        {r.purchases} compra{r.purchases > 1 ? 's' : ''} · a cada {r.intervalDays} dias ({r.basis === 'cliente' ? 'ritmo dela' : 'duração do produto'})
                      </p>
                    </td>
                    <td className="text-sm">{day(r.lastPurchase)}</td>
                    <td className="text-sm">
                      {day(r.dueDate)}
                      <p className={`text-xs ${r.daysLate > 0 ? 'text-red-600' : 'text-ink-soft'}`}>{r.daysLate > 0 ? `${r.daysLate} dias atrasada` : r.daysLate === 0 ? 'hoje' : `em ${-r.daysLate} dias`}</p>
                    </td>
                    <td className="text-right">
                      <ContactButtons
                        phone={r.allowWhatsapp ? r.phone : null}
                        contacted={r.lastContactAt}
                        onSend={() => send(r.phone!, fillMessage(s?.messages.repurchase ?? '', { ...vars, nome: r.customerName.split(' ')[0], produto: r.productName, cashback: formatMoney(r.cashbackBalance) }), { customerId: r.customerId, productId: r.productId, kind: 'recompra' })}
                        onMark={() => contact.mutate({ customerId: r.customerId, productId: r.productId, kind: 'recompra' })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'sumidas' && (
        <section className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3 text-sm">
            <p className="text-ink-soft">Compraram nos últimos 12 meses e não voltam. Quem gastou mais aparece primeiro.</p>
            <label className="flex items-center gap-2">
              Sem comprar há mais de
              <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[30, 45, 60, 90, 180].map((n) => (
                  <option key={n} value={n}>
                    {n} dias
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lapsed.isLoading ? (
            <Loading />
          ) : !lapsed.data?.length ? (
            <Empty><p className="font-medium text-ink">Ninguém sumido</p><p>Ótimo sinal: todo mundo voltou dentro do prazo.</p></Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="text-right">Já gastou</th>
                  <th className="text-right">Cashback</th>
                  <th>Última compra</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lapsed.data.map((r) => (
                  <tr key={r.customerId} className={r.lastContactAt ? 'opacity-60' : ''}>
                    <td>
                      <p className="font-medium">
                        {r.customerName} {r.isMember && <span className="badge ml-1 bg-brand-soft text-brand">Membro</span>}
                      </p>
                      <p className="text-xs text-ink-soft">{r.phone ? formatPhone(r.phone) : 'sem celular'}</p>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMoney(r.totalSpent)}
                      <p className="text-xs text-ink-soft">{r.purchases} compras</p>
                    </td>
                    <td className="text-right tabular-nums">{r.cashbackBalance > 0 ? formatMoney(r.cashbackBalance) : '—'}</td>
                    <td className="text-sm">
                      {day(r.lastPurchase)}
                      <p className="text-xs text-ink-soft">há {r.daysAway} dias</p>
                    </td>
                    <td className="text-right">
                      <ContactButtons
                        phone={r.allowWhatsapp ? r.phone : null}
                        contacted={r.lastContactAt}
                        onSend={() => send(r.phone!, fillMessage(s?.messages.lapsed ?? '', { ...vars, nome: r.customerName.split(' ')[0], cashback: formatMoney(r.cashbackBalance) }), { customerId: r.customerId, kind: 'sumida' })}
                        onMark={() => contact.mutate({ customerId: r.customerId, kind: 'sumida' })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'aniversarios' && (
        <section className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3 text-sm">
            <p className="text-ink-soft">
              {s?.birthdayCoupon ? (
                <>
                  Cupom de aniversário ativo: <b className="text-ink">{s.birthdayCoupon.code}</b> ({s.birthdayCoupon.summary}). O caixa sugere sozinho.
                </>
              ) : (
                <>Sem cupom de aniversário ativo. Crie em Campanhas (cupom para "Aniversariantes do mês").</>
              )}
            </p>
            <select className="input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mês">
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2026, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          {birthdays.isLoading ? (
            <Loading />
          ) : !birthdays.data?.length ? (
            <Empty><p className="font-medium text-ink">Nenhum aniversariante</p><p>Cadastre a data de nascimento no cliente (no caixa ou no app).</p></Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Cliente</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {birthdays.data.map((r) => (
                  <tr key={r.customerId} className={r.lastContactAt ? 'opacity-60' : ''}>
                    <td className="text-lg font-semibold tabular-nums">{String(r.day).padStart(2, '0')}</td>
                    <td>
                      <p className="font-medium">{r.customerName}</p>
                      <p className="text-xs text-ink-soft">{r.phone ? formatPhone(r.phone) : 'sem celular'}</p>
                    </td>
                    <td className="text-right">
                      <ContactButtons
                        phone={r.allowWhatsapp ? r.phone : null}
                        contacted={r.lastContactAt}
                        onSend={() => send(r.phone!, fillMessage(s?.messages.birthday ?? '', { ...vars, nome: r.customerName.split(' ')[0] }), { customerId: r.customerId, kind: 'aniversario' })}
                        onMark={() => contact.mutate({ customerId: r.customerId, kind: 'aniversario' })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {editing && s && <MessagesDrawer messages={s.messages} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); client.invalidateQueries({ queryKey: ['growth-summary'] }); }} />}
    </div>
  );
}

function ContactButtons({ phone, contacted, onSend, onMark }: { phone: string | null; contacted: string | null; onSend: () => void; onMark: () => void }) {
  if (contacted) return <span className="text-xs text-ink-soft">Contato em {new Date(contacted).toLocaleDateString('pt-BR')}</span>;
  return (
    <div className="flex justify-end gap-2">
      {phone ? (
        <button className="btn-primary px-3 py-1.5" onClick={onSend}>
          WhatsApp
        </button>
      ) : (
        <span className="self-center text-xs text-ink-soft">sem WhatsApp</span>
      )}
      <button className="btn-ghost px-3 py-1.5" onClick={onMark} title="Falou por outro meio (pessoalmente, ligação)">
        Marcar
      </button>
    </div>
  );
}

function MessagesDrawer({ messages, onClose, onSaved }: { messages: GrowthSummary['messages']; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(messages);
  const save = useMutation({ mutationFn: () => api('/growth/messages', { method: 'PUT', json: f }), onSuccess: onSaved });
  return (
    <Drawer title="Mensagens do WhatsApp" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          Use <code>{'{nome}'}</code>, <code>{'{produto}'}</code>, <code>{'{cashback}'}</code>, <code>{'{cupom}'}</code>, <code>{'{loja}'}</code> e <code>{'{app}'}</code>. Apagar o texto volta para o padrão.
        </p>
        {(
          [
            ['repurchase', 'Hora de repor'],
            ['lapsed', 'Cliente sumida'],
            ['birthday', 'Aniversário'],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <textarea className="input min-h-[96px]" maxLength={600} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <ErrorBox error={save.error} />
        <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          Salvar mensagens
        </button>
      </div>
    </Drawer>
  );
}
