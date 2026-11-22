import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, formatPhone, normalizeText, type CustomerOption, type ShopCatalog, type ShopProduct } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { formatDateTime, formatTime } from '../../components/format';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';

/**
 * Atendimento no WhatsApp: conversas com as clientes, respostas da equipe e do agente de IA,
 * produto e carrinho (link da loja online) dentro da conversa.
 */

interface Status { ligado: boolean; provedor: 'zapi' | 'meta' | 'webhook' | 'teste' | null; janela24h: boolean; modelos: boolean; slug: string | null; ia: { ligado: boolean; nome: string }; entrada: string | null; faltaSegredo: boolean }
interface Resumo { id: string; phone: string; name: string | null; customerId: string | null; status: 'aberta' | 'resolvida'; assignedTo: string | null; aiEnabled: boolean; needsHuman: boolean; unread: number; lastMessageAt: string; lastPreview: string | null; janelaAberta: boolean; janelaFechaEm: string | null }
interface Mensagem { id: string; direction: 'in' | 'out'; author: 'cliente' | 'equipe' | 'ia' | 'sistema'; userName: string | null; text: string; media: string | null; status: string; error: string | null; createdAt: string }
interface Conversa extends Resumo { assignedName: string | null; customer: { id: string; name: string; isMember: boolean; cashback: number; memberCode: string | null; allowWhatsapp: boolean } | null; messages: Mensagem[] }
interface ConfigIa { ligado: boolean; nome: string; instrucoes: string; maxRespostas: number; pausarQuandoEquipeResponde: boolean }

const FILTROS: [string, string][] = [['abertas', 'Abertas'], ['equipe', 'Precisam da equipe'], ['ia', 'IA atendendo'], ['minhas', 'Minhas'], ['resolvidas', 'Resolvidas']];
const PROVEDOR: Record<string, string> = { zapi: 'Z-API (número por QR Code)', meta: 'API oficial do WhatsApp (Meta)', webhook: 'Webhook (Make, n8n, ponte)', teste: 'Teste (não envia nada)' };
const nomeDe = (c: { name: string | null; phone: string }) => c.name || formatPhone(c.phone);

export function WhatsappScreen() {
  const [aba, setAba] = useState<'atendimento' | 'config'>('atendimento');
  const status = useQuery({ queryKey: ['wa', 'status'], queryFn: () => api<Status>('/whatsapp/status') });
  const gestao = can('settings.manage');
  return (
    <div className="space-y-4">
      <PageHeader title="WhatsApp" subtitle="Conversas com as clientes num lugar só: a equipe responde, o agente de IA tira dúvidas e monta o carrinho, e o link já abre a loja online com tudo dentro." />
      {gestao && (
        <div className="flex gap-1 border-b border-slate-200" role="tablist">
          {(
            [
              ['atendimento', 'Atendimento'],
              ['config', 'Configurar'],
            ] as const
          ).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === k ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>
              {t}
            </button>
          ))}
        </div>
      )}
      {status.isLoading ? <Loading /> : status.error ? <ErrorBox error={status.error} /> : (
        <>
          {!status.data!.ligado && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              O WhatsApp ainda não está conectado no servidor. {gestao ? 'Veja em Configurar como ligar (Z-API ou API oficial).' : 'Peça para a gestão conectar.'} Dá para ver as conversas, mas nada é enviado.
            </div>
          )}
          {aba === 'atendimento' ? <Atendimento status={status.data!} /> : <Configurar status={status.data!} />}
        </>
      )}
    </div>
  );
}

function Atendimento({ status }: { status: Status }) {
  const [filtro, setFiltro] = useState('abertas');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const lista = useQuery({ queryKey: ['wa', 'lista', filtro, busca], queryFn: () => api<Resumo[]>(`/whatsapp/conversations?filtro=${filtro}&busca=${encodeURIComponent(busca)}`), refetchInterval: 5000 });
  const atual = sel ?? lista.data?.[0]?.id ?? null;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="card flex max-h-[60vh] flex-col overflow-hidden lg:max-h-[calc(100vh-230px)]">
        <div className="space-y-2 border-b border-slate-200 p-3">
          <div className="flex gap-2">
            <input className="input" placeholder="Buscar nome ou celular" aria-label="Buscar conversa" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {can('customer.manage') && <button className="btn-primary px-3" title="Nova conversa" aria-label="Nova conversa" onClick={() => setNova(true)}>+</button>}
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTROS.map(([k, t]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${filtro === k ? 'bg-brand text-white' : 'bg-cream text-ink-soft hover:text-ink'}`}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {lista.isLoading ? <Loading /> : !lista.data?.length ? <Empty>Nenhuma conversa aqui.</Empty> : lista.data.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left ${c.id === atual ? 'bg-brand-soft' : 'hover:bg-cream/60'}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 text-sm font-semibold text-brand">{(c.name ?? '#').slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <b className="truncate text-sm text-ink">{nomeDe(c)}</b>
                  <span className="flex-1" />
                  <small className="shrink-0 text-[11px] text-ink-soft">{formatTime(c.lastMessageAt)}</small>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs text-ink-soft">{c.lastPreview}</span>
                  <span className="flex-1" />
                  {c.needsHuman && <span className="badge shrink-0 bg-red-50 text-red-700">equipe</span>}
                  {!c.needsHuman && c.aiEnabled && status.ia.ligado && c.status === 'aberta' && <span className="badge shrink-0 bg-amber-50 text-amber-700">IA</span>}
                  {c.unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-emerald-600 px-1 text-[11px] font-semibold text-white">{c.unread}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      {nova ? <NovaConversa aoCriar={(id) => { setNova(false); setSel(id); setFiltro('abertas'); }} aoFechar={() => setNova(false)} /> : atual ? <Chat key={atual} id={atual} status={status} /> : <div className="card p-10 text-center text-sm text-ink-soft">Quando uma cliente mandar mensagem, a conversa aparece aqui.</div>}
    </div>
  );
}

function NovaConversa({ aoCriar, aoFechar }: { aoCriar: (id: string) => void; aoFechar: () => void }) {
  const [q, setQ] = useState('');
  const [fone, setFone] = useState('');
  const busca = useQuery({ queryKey: ['wa', 'clientes', q], queryFn: () => api<CustomerOption[]>(`/customers/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 && can('sale.create') });
  const criar = useMutation({ mutationFn: (d: { customerId?: string; phone?: string }) => api<{ id: string }>('/whatsapp/conversations', { method: 'POST', json: d }), onSuccess: (r) => aoCriar(r.id) });
  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-ink">Nova conversa</h2>
        <button className="text-sm text-ink-soft hover:text-ink" onClick={aoFechar}>Fechar</button>
      </div>
      <Field label="Cliente cadastrada">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, celular ou cartão" />
      </Field>
      <div className="space-y-1">
        {busca.data?.map((c) => (
          <button key={c.id} disabled={!c.phone || criar.isPending} onClick={() => criar.mutate({ customerId: c.id })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-cream disabled:opacity-50">
            <span>{c.name} {c.isMember && <span className="badge ml-1 bg-brand-soft text-brand-dark">membro</span>}</span>
            <span className="text-ink-soft">{c.phone ? formatPhone(c.phone) : 'sem celular'}</span>
          </button>
        ))}
      </div>
      <Field label="Ou um celular" hint="Com DDD. Na API oficial, a primeira mensagem para quem não escreveu nas últimas 24 h precisa ser um modelo aprovado.">
        <div className="flex gap-2">
          <input className="input" value={fone} onChange={(e) => setFone(e.target.value)} placeholder="(27) 99999-9999" inputMode="tel" />
          <button className="btn-primary" disabled={fone.replace(/\D/g, '').length < 10 || criar.isPending} onClick={() => criar.mutate({ phone: fone })}>Abrir</button>
        </div>
      </Field>
      <ErrorBox error={criar.error} />
    </div>
  );
}

function Chat({ id, status }: { id: string; status: Status }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [painel, setPainel] = useState<'produtos' | 'cliente' | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const c = useQuery({ queryKey: ['wa', 'conversa', id], queryFn: () => api<Conversa>(`/whatsapp/conversations/${id}`), refetchInterval: 3000 });
  const atualizar = () => { qc.invalidateQueries({ queryKey: ['wa', 'conversa', id] }); qc.invalidateQueries({ queryKey: ['wa', 'lista'] }); };
  const enviar = useMutation({ mutationFn: (t: string) => api(`/whatsapp/conversations/${id}/messages`, { method: 'POST', json: { texto: t } }), onSuccess: () => { setTexto(''); atualizar(); }, onError: atualizar });
  const mudar = useMutation({ mutationFn: (d: Record<string, unknown>) => api(`/whatsapp/conversations/${id}`, { method: 'PATCH', json: d }), onSuccess: atualizar });
  const total = c.data?.messages.length ?? 0;
  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [total]);
  if (c.isLoading) return <Loading />;
  if (!c.data) return <ErrorBox error={c.error} />;
  const d = c.data;
  const pode = can('customer.manage');
  const iaAtendendo = status.ia.ligado && d.aiEnabled && !d.needsHuman && d.status === 'aberta';
  return (
    <section className="card flex h-[calc(100vh-230px)] min-h-[480px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <b className="font-display text-base text-ink">{nomeDe(d)}</b>
          <div className="text-xs text-ink-soft">
            {formatPhone(d.phone)}
            {d.customer ? <> · {d.customer.isMember ? `membro${d.customer.memberCode ? ` ${d.customer.memberCode}` : ''}` : 'cliente'} · cashback {formatMoney(d.customer.cashback)}</> : ' · sem cadastro'}
            {d.assignedName && <> · com {d.assignedName}</>}
          </div>
        </div>
        <span className="flex-1" />
        {pode && (
          <>
            {status.ia.ligado && (
              <button className={`btn px-3 py-1.5 text-xs ${iaAtendendo ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-300' : 'btn-ghost'}`} disabled={mudar.isPending} onClick={() => mudar.mutate({ aiEnabled: !(d.aiEnabled && !d.needsHuman) })} title="Liga ou desliga o agente de IA nesta conversa">
                {iaAtendendo ? `⚡ ${status.ia.nome} atendendo · pausar` : `Devolver para ${status.ia.nome}`}
              </button>
            )}
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={mudar.isPending} onClick={() => mudar.mutate({ assumir: !d.assignedTo })}>{d.assignedTo ? 'Soltar' : 'Assumir'}</button>
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setPainel(painel === 'cliente' ? null : 'cliente')}>{d.customer ? 'Cliente' : 'Vincular cliente'}</button>
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={mudar.isPending} onClick={() => mudar.mutate({ status: d.status === 'aberta' ? 'resolvida' : 'aberta' })}>{d.status === 'aberta' ? '✓ Resolver' : 'Reabrir'}</button>
          </>
        )}
      </div>
      {d.needsHuman && <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">🙋 A IA passou esta conversa para a equipe. Responda por aqui.</div>}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto bg-cream/50 p-4">
          {d.messages.map((m) =>
            m.author === 'sistema' && m.direction === 'out' && m.text.startsWith('🙋') ? (
              <div key={m.id} className="self-center rounded-full bg-white px-3 py-1 text-xs text-ink-soft shadow-sm">{m.text}</div>
            ) : (
              <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm lg:max-w-[70%] ${m.direction === 'in' ? 'self-start rounded-bl-md bg-white text-ink' : m.author === 'ia' ? 'self-end rounded-br-md bg-amber-50 text-ink ring-1 ring-amber-200' : 'self-end rounded-br-md bg-emerald-50 text-ink ring-1 ring-emerald-200'}`}>
                {m.direction === 'out' && <div className="mb-0.5 text-[11px] font-semibold text-ink-soft">{m.author === 'ia' ? `⚡ ${status.ia.nome} (IA)` : m.author === 'sistema' ? 'Sistema' : (m.userName ?? 'Equipe')}</div>}
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
                <div className="mt-0.5 text-right text-[10px] text-ink-soft">
                  {formatDateTime(m.createdAt)}
                  {m.status === 'falhou' && <span className="ml-1 font-semibold text-red-600" title={m.error ?? ''}>· não enviada{m.error ? `: ${m.error}` : ''}</span>}
                </div>
              </div>
            ),
          )}
          <div ref={fim} />
        </div>
        {painel === 'produtos' && <Produtos slug={status.slug} conversaId={id} aoEnviar={atualizar} />}
        {painel === 'cliente' && <Cliente conversa={d} aoMudar={(customerId) => mudar.mutate({ customerId })} />}
      </div>
      <div className="px-4 empty:hidden"><ErrorBox error={enviar.error ?? mudar.error} /></div>
      {pode && (d.janelaAberta ? (
        <div className="flex items-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <button className={`px-3 ${painel === 'produtos' ? 'btn-primary' : 'btn-ghost'}`} title="Produtos e carrinho" aria-label="Produtos e carrinho" onClick={() => setPainel(painel === 'produtos' ? null : 'produtos')}>🛒</button>
          <textarea
            className="input flex-1 resize-none"
            rows={2}
            value={texto}
            aria-label="Mensagem"
            placeholder={status.ligado ? (iaAtendendo ? 'Ao responder, a IA pausa nesta conversa' : 'Escreva a resposta') : 'WhatsApp desconectado'}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (texto.trim() && !enviar.isPending) enviar.mutate(texto.trim()); } }}
          />
          <button className="btn-primary" disabled={!texto.trim() || enviar.isPending || !status.ligado} onClick={() => enviar.mutate(texto.trim())}>Enviar</button>
        </div>
      ) : (
        <Modelo conversaId={id} podeModelo={status.modelos} aoEnviar={atualizar} />
      ))}
    </section>
  );
}

/** API oficial, fora das 24 h: só modelo aprovado na Meta. */
function Modelo({ conversaId, podeModelo, aoEnviar }: { conversaId: string; podeModelo: boolean; aoEnviar: () => void }) {
  const [nome, setNome] = useState('');
  const [idioma, setIdioma] = useState('pt_BR');
  const [params, setParams] = useState('');
  const enviar = useMutation({ mutationFn: () => api(`/whatsapp/conversations/${conversaId}/template`, { method: 'POST', json: { nome: nome.trim(), idioma, parametros: params.split('|').map((x) => x.trim()).filter(Boolean) } }), onSuccess: () => { setNome(''); setParams(''); aoEnviar(); } });
  return (
    <div className="space-y-2 border-t border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-xs text-amber-800">Passou de 24 h desde a última mensagem da cliente: pela API oficial, só dá para mandar um <b>modelo aprovado</b> na Meta. Quando ela responder, a conversa abre de novo.</p>
      {podeModelo && (
        <div className="flex flex-wrap items-end gap-2">
          <input className="input w-48" placeholder="nome_do_modelo" aria-label="Nome do modelo" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="input w-24" aria-label="Idioma" value={idioma} onChange={(e) => setIdioma(e.target.value)} />
          <input className="input min-w-[200px] flex-1" placeholder="Variáveis, separadas por | (ex.: Ana | R$ 12,00)" aria-label="Variáveis do modelo" value={params} onChange={(e) => setParams(e.target.value)} />
          <button className="btn-primary" disabled={!nome.trim() || enviar.isPending} onClick={() => enviar.mutate()}>Mandar modelo</button>
        </div>
      )}
      <ErrorBox error={enviar.error} />
    </div>
  );
}

function Produtos({ slug, conversaId, aoEnviar }: { slug: string | null; conversaId: string; aoEnviar: () => void }) {
  const [q, setQ] = useState('');
  const [carrinho, setCarrinho] = useState<Map<string, number>>(new Map());
  const cat = useQuery({ queryKey: ['wa', 'catalogo', slug], queryFn: () => api<ShopCatalog>(`/shop/${slug}/catalog`), enabled: !!slug, staleTime: 60_000 });
  const lista = useMemo(() => {
    const t = normalizeText(q);
    return (cat.data?.products ?? []).filter((p) => !t || normalizeText(`${p.name} ${p.brand ?? ''}`).includes(t)).slice(0, 40);
  }, [cat.data, q]);
  const porId = useMemo(() => new Map((cat.data?.products ?? []).map((p) => [p.id, p])), [cat.data]);
  const produto = useMutation({ mutationFn: (productId: string) => api(`/whatsapp/conversations/${conversaId}/product`, { method: 'POST', json: { productId } }), onSuccess: aoEnviar });
  const mandar = useMutation({
    mutationFn: () => api<{ indisponiveis: string[] }>(`/whatsapp/conversations/${conversaId}/cart`, { method: 'POST', json: { itens: [...carrinho].map(([productId, quantity]) => ({ productId, quantity })) } }),
    onSuccess: () => { setCarrinho(new Map()); aoEnviar(); },
  });
  const mexer = (p: ShopProduct, delta: number) => setCarrinho((m) => { const n = new Map(m); const v = (n.get(p.id) ?? 0) + delta; if (v <= 0) n.delete(p.id); else n.set(p.id, Math.min(50, v)); return n; });
  const total = [...carrinho].reduce((s, [id, q2]) => s + (porId.get(id)?.price ?? 0) * q2, 0);
  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-xs shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl lg:static lg:w-80 lg:shadow-none">
      <div className="border-b border-slate-200 p-3"><input className="input" placeholder="Buscar produto" aria-label="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="flex-1 overflow-y-auto">
        {!slug ? <Empty>A loja não tem endereço público.</Empty> : cat.isLoading ? <Loading /> : lista.map((p) => (
          <div key={p.id} className={`border-b border-slate-100 px-3 py-2 ${p.available ? '' : 'opacity-50'}`}>
            <div className="text-sm text-ink">{p.name}</div>
            <div className="text-xs text-ink-soft">{formatMoney(p.price)}{p.memberPrice < p.price && ` · membro ${formatMoney(p.memberPrice)}`}{!p.available && ' · em falta'}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <button className="btn-ghost px-2 py-1 text-xs" disabled={produto.isPending} onClick={() => produto.mutate(p.id)}>Mandar</button>
              {carrinho.get(p.id) ? (
                <span className="flex items-center gap-1 text-xs">
                  <button className="btn-ghost px-2 py-1" aria-label="Menos" onClick={() => mexer(p, -1)}>−</button>
                  <b className="w-5 text-center">{carrinho.get(p.id)}</b>
                  <button className="btn-ghost px-2 py-1" aria-label="Mais" onClick={() => mexer(p, 1)}>+</button>
                </span>
              ) : (
                <button className="btn-ghost px-2 py-1 text-xs" disabled={!p.available} onClick={() => mexer(p, 1)}>+ Carrinho</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {carrinho.size > 0 && (
        <div className="space-y-2 border-t border-slate-200 p-3">
          <div className="text-sm"><b>{[...carrinho.values()].reduce((a, b) => a + b, 0)}</b> item(ns) · {formatMoney(total)}</div>
          <button className="btn-primary w-full" disabled={mandar.isPending} onClick={() => mandar.mutate()}>Mandar link do carrinho</button>
        </div>
      )}
      <div className="px-3 pb-2 empty:hidden"><ErrorBox error={produto.error ?? mandar.error} /></div>
    </aside>
  );
}

function Cliente({ conversa, aoMudar }: { conversa: Conversa; aoMudar: (customerId: string | null) => void }) {
  const [q, setQ] = useState(conversa.phone.slice(-8));
  const busca = useQuery({ queryKey: ['wa', 'clientes', q], queryFn: () => api<CustomerOption[]>(`/customers/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 && can('sale.create') });
  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-xs shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-white p-3 shadow-xl lg:static lg:w-80 lg:shadow-none">
      {conversa.customer ? (
        <div className="space-y-1 rounded-lg bg-cream p-3 text-sm">
          <b>{conversa.customer.name}</b>
          <div className="text-ink-soft">{conversa.customer.isMember ? 'Membro' : 'Cliente'} · cashback {formatMoney(conversa.customer.cashback)}</div>
          {!conversa.customer.allowWhatsapp && <div className="text-xs text-amber-700">Não aceita mensagens de campanha pelo WhatsApp.</div>}
          <button className="text-xs text-red-700 underline" onClick={() => aoMudar(null)}>Desvincular</button>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Esta conversa não está ligada a nenhuma cliente. Procure pelo nome ou celular:</p>
      )}
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, celular ou cartão" aria-label="Buscar cliente" />
      {busca.data?.map((c) => (
        <button key={c.id} onClick={() => aoMudar(c.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-cream">
          {c.name}<div className="text-xs text-ink-soft">{c.phone ? formatPhone(c.phone) : 'sem celular'}{c.isMember ? ' · membro' : ''}</div>
        </button>
      ))}
    </aside>
  );
}

function Configurar({ status }: { status: Status }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['wa', 'config'], queryFn: () => api<ConfigIa>('/whatsapp/config') });
  const [f, setF] = useState<ConfigIa | null>(null);
  const salvar = useMutation({ mutationFn: (d: ConfigIa) => api('/whatsapp/config', { method: 'PUT', json: d }), onSuccess: () => { setF(null); qc.invalidateQueries({ queryKey: ['wa'] }); } });
  if (cfg.isLoading) return <Loading />;
  if (!cfg.data) return <ErrorBox error={cfg.error} />;
  const v = f ?? cfg.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-4 p-5">
        <h2 className="font-display text-lg text-ink">Agente de IA</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.ligado} onChange={(e) => setF({ ...v, ligado: e.target.checked })} /> Responder as clientes automaticamente</label>
        <Field label="Nome do agente" hint="Como ele se apresenta (ex.: Sol).">
          <input className="input max-w-xs" value={v.nome} onChange={(e) => setF({ ...v, nome: e.target.value })} />
        </Field>
        <Field label="Orientações da loja" hint="Tom, o que destacar e o que nunca fazer. Ex.: “Sempre ofereça o kit do mês”, “Entrega só até as 18h”.">
          <textarea className="input" rows={6} value={v.instrucoes} onChange={(e) => setF({ ...v, instrucoes: e.target.value })} />
        </Field>
        <Field label="Respostas seguidas antes de chamar a equipe">
          <input className="input w-24" type="number" min={1} max={40} value={v.maxRespostas} onChange={(e) => setF({ ...v, maxRespostas: Number(e.target.value) || 1 })} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.pausarQuandoEquipeResponde} onChange={(e) => setF({ ...v, pausarQuandoEquipeResponde: e.target.checked })} /> Quando alguém da equipe responde, a IA para naquela conversa</label>
        <p className="text-xs text-ink-soft">O agente consulta o catálogo do app (preço, preço de membro, ofertas e o que tem disponível), monta o carrinho em um link da loja online, informa entrega e clube, mostra o cashback e a situação dos pedidos da cliente, e chama a equipe em reclamação, troca, problema de pagamento ou quando pedem uma pessoa. Precisa da chave do Claude (ANTHROPIC_API_KEY) no servidor.</p>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary" disabled={!f || salvar.isPending} onClick={() => f && salvar.mutate(f)}>Salvar</button>
      </div>
      <div className="card space-y-3 p-5 text-sm">
        <h2 className="font-display text-lg text-ink">Canal</h2>
        <p>{status.provedor ? <>Conectado por <b>{PROVEDOR[status.provedor]}</b>.</> : <b>Desconectado.</b>}</p>
        {status.entrada && (
          <Field label={status.provedor === 'meta' ? 'URL do webhook (cole no app da Meta › WhatsApp › Configuração)' : 'URL para receber mensagens (cole no webhook "Ao receber" da Z-API)'}>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={status.entrada} onFocus={(e) => e.target.select()} />
              <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(status.entrada!)}>Copiar</button>
            </div>
          </Field>
        )}
        {status.faltaSegredo && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">Falta WHATSAPP_INBOUND_SECRET no .env do servidor: sem ele as mensagens das clientes não entram.</div>}
        <div className="space-y-2 text-ink-soft">
          <p><b className="text-ink">Para conectar</b>, a gestão coloca no arquivo .env do servidor (nunca pela tela) e roda a atualização:</p>
          <p><b className="text-ink">Z-API:</b> ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN e WHATSAPP_INBOUND_SECRET (uma senha longa qualquer, que entra na URL de entrada).</p>
          <p><b className="text-ink">API oficial (Meta):</b> META_WA_TOKEN, META_WA_PHONE_ID, META_WA_APP_SECRET e META_WA_VERIFY_TOKEN. Na API oficial, fora das 24 h só vão modelos aprovados.</p>
        </div>
      </div>
    </div>
  );
}
