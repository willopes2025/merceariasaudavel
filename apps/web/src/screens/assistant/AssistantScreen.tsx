import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, session } from '../../lib/api';
import { formatDateTime } from '../../components/format';
import { ErrorBox, Field, Loading, PageHeader } from '../../components/ui';

/**
 * Assistente da equipe (portado do assistente da Aritana): conversa por texto ou voz, cartões de ação com
 * confirmação, anexos, agentes agendados (rotinas), pedidos para a equipe e configuração.
 */

interface AnexoInfo { id: string; nome: string; mime: string }
interface Mensagem { id: string; papel: 'user' | 'assistant'; texto: string; fala: string | null; origem: string | null; criadoEm: string; anexos: AnexoInfo[] }
interface Pendente { chave: string; nome: string; mime: string; tamanho: number; previa: string | null; id?: string; leitura?: string; erro?: string }
interface Acao { id: string; ferramenta: string; risco: string; status: string; resumo: string | null; previa: unknown; resultado: unknown; erro: string | null; progresso: { feitos: number; total: number; falhas: number } | null; criadoEm: string }
interface Sessao { id: string; titulo: string; ocupada: boolean; aprovacao: 'perguntar' | 'automatico'; mensagens: Mensagem[]; acoes: Acao[] }
interface Estado { ligado: boolean; voz: boolean; vozResposta: 'elevenlabs' | 'openai' | 'navegador'; nome: string; ferramentas: { nome: string; risco: string }[]; podeConfigurar: boolean; podeAutomatico: boolean }
interface Rotina { id: string; titulo: string; instrucao: string; quando: string; ativa: boolean; aprovacao: 'perguntar' | 'automatico'; proximaEm: string; ultimaEm: string | null; ultimaSessaoId: string | null; ultimoErro: string | null; emails: string[] }
interface PedidoEquipe { id: string; numero: number; tipo: string; titulo: string; especificacao: string; plano: string[]; status: string; autor: string | null; criadoEm: string }

const BASE = import.meta.env.VITE_API_URL ?? '/v1';
const comToken = (): HeadersInit => ({ authorization: `Bearer ${session.token() ?? ''}` });
const icone = (mime: string) => (mime.startsWith('image/') ? '🖼' : mime === 'application/pdf' ? '📄' : mime.startsWith('video/') ? '🎬' : mime.startsWith('audio/') ? '🎵' : mime.includes('sheet') || mime === 'text/csv' ? '📊' : '📝');
const tamanhoLegivel = (b: number) => (b > 1_000_000 ? `${(b / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);
const OUVIR = 'mercearia.assistente.ouvir';

const ROTULO: Record<string, string> = {
  painel_do_dia: 'Abriu o painel do dia',
  resumo_negocio: 'Levantou os resultados do período',
  consultar_dados: 'Consultou os dados',
  buscar_produtos: 'Buscou produtos',
  alertas_estoque: 'Analisou o estoque',
  buscar_clientes: 'Buscou clientes',
  ficha_cliente: 'Abriu a ficha da cliente',
  oportunidades_clientes: 'Levantou quem chamar',
  consultar_financeiro: 'Consultou o financeiro',
  pedidos_em_andamento: 'Viu os pedidos em andamento',
  parceiros_do_mes: 'Consultou os parceiros',
  listar_campanhas: 'Consultou as campanhas',
  criar_campanha: 'Criar campanha',
  ligar_campanha: 'Ligar ou pausar campanha',
  alterar_preco: 'Alterar preço',
  criar_pedido_compra: 'Pedido de compra',
  lancar_conta_pagar: 'Lançar conta a pagar',
  enviar_whatsapp: 'Enviar WhatsApp',
  enviar_whatsapp_em_lote: 'Envio de WhatsApp em lote',
  enviar_email: 'Enviar e-mail',
  agendar_rotina: 'Criar agente agendado',
  gerenciar_rotinas: 'Ajustou os agentes agendados',
  registrar_pedido: 'Registrou pedido para a equipe',
  listar_pedidos: 'Consultou os pedidos',
};
const SUGESTOES = ['Como foi o mês até agora, comparado ao mês passado?', 'O que preciso comprar esta semana?', 'Quem sumiu há mais de 45 dias e tem cashback esperando?', 'Todo dia às 20h me manda por e-mail o resumo do dia'];
const STATUS_PEDIDO: Record<string, [string, string]> = { novo: ['bg-amber-50 text-amber-700', 'Novo'], em_analise: ['bg-amber-50 text-amber-700', 'Em análise'], em_andamento: ['bg-brand-soft text-brand-dark', 'Em andamento'], pronto: ['bg-emerald-50 text-emerald-700', 'Pronto'], recusado: ['bg-slate-100 text-slate-500', 'Recusado'] };

// ───────────── Voz ─────────────

function falarNoNavegador(texto: string) {
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(texto.replace(/https?:\/\/\S+/g, 'o link').slice(0, 1500));
    u.lang = 'pt-BR';
    const voz = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith('pt'));
    if (voz) u.voice = voz;
    s.speak(u);
  } catch {
    /* navegador sem voz */
  }
}

let tocando: HTMLAudioElement | null = null;
function calar() {
  tocando?.pause();
  tocando = null;
  window.speechSynthesis?.cancel();
}

async function falar(texto: string, modo: Estado['vozResposta'] = 'navegador', exemplo?: { provedor: string; voz: string }) {
  calar();
  if (modo === 'navegador' && !exemplo) return falarNoNavegador(texto);
  try {
    const r = await fetch(`${BASE}/assistant/speak`, { method: 'POST', headers: { 'content-type': 'application/json', ...comToken() }, body: JSON.stringify({ texto, ...(exemplo ?? {}) }) });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? 'Falha na voz');
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    tocando = a;
    await a.play().catch(() => {
      throw new Error('O navegador não conseguiu tocar o áudio. Clique na página e tente de novo.');
    });
  } catch (e) {
    if (exemplo) throw e;
    falarNoNavegador(texto);
  }
}

// ───────────── Tela ─────────────

type Aba = 'conversa' | 'agentes' | 'pedidos' | 'config';

export function AssistantScreen() {
  const [aba, setAba] = useState<Aba>('conversa');
  const [sel, setSel] = useState<string | null>(null);
  const estado = useQuery({ queryKey: ['assistente', 'estado'], queryFn: () => api<Estado>('/assistant/state') });
  const abas: [Aba, string][] = [['conversa', 'Conversa'], ['agentes', 'Agentes'], ['pedidos', 'Pedidos']];
  if (estado.data?.podeConfigurar) abas.push(['config', 'Configurar']);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Assistente"
        subtitle={`${estado.data?.nome && estado.data.nome !== 'Assistente' ? `Você está falando com ${estado.data.nome}. ` : ''}Fale, escreva ou anexe o que precisa: ele consulta o sistema, analisa os resultados com você e executa ações (as que mandam mensagem ou mudam algo esperam sua confirmação).`}
      />
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {abas.map(([k, t]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === k ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      {estado.isLoading ? (
        <Loading />
      ) : estado.error ? (
        <ErrorBox error={estado.error} />
      ) : !estado.data?.ligado ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">A inteligência artificial não está ligada. Peça para colocarem a chave do Claude (ANTHROPIC_API_KEY) no servidor.</div>
      ) : aba === 'conversa' ? (
        <Conversas estado={estado.data} sel={sel} setSel={setSel} />
      ) : aba === 'agentes' ? (
        <Agentes podeAutomatico={estado.data.podeAutomatico} abrir={(id) => { setSel(id); setAba('conversa'); }} />
      ) : aba === 'pedidos' ? (
        <Pedidos podeMudar={estado.data.podeConfigurar} />
      ) : (
        <Configurar />
      )}
    </div>
  );
}

function Conversas({ estado, sel, setSel }: { estado: Estado; sel: string | null; setSel: (id: string | null) => void }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['assistente', 'sessoes'], queryFn: () => api<{ id: string; titulo: string; ocupada: boolean; atualizadoEm: string }[]>('/assistant/sessions') });
  const nova = useMutation({ mutationFn: () => api<{ id: string }>('/assistant/sessions', { method: 'POST', json: {} }), onSuccess: (s) => { setSel(s.id); qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] }); } });
  const atual = sel ?? lista.data?.[0]?.id ?? null;
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/assistant/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) => { if (id === atual) setSel(null); qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] }); qc.removeQueries({ queryKey: ['assistente', 'sessao', id] }); },
  });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="flex max-h-48 flex-col gap-1.5 overflow-auto lg:sticky lg:top-3 lg:max-h-[calc(100vh-200px)]">
        <button className="btn-primary" onClick={() => nova.mutate()} disabled={nova.isPending}>Nova conversa</button>
        {lista.data?.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => setSel(s.id)}
            onKeyDown={(e) => e.key === 'Enter' && setSel(s.id)}
            className={`group relative flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 pr-9 text-left ${s.id === atual ? 'border-brand/50 bg-brand-soft' : 'border-slate-200 bg-white hover:bg-cream'}`}
          >
            <span className="line-clamp-2 text-sm leading-snug text-ink">{s.titulo}</span>
            <small className="text-xs text-ink-soft">{s.ocupada ? 'trabalhando…' : formatDateTime(s.atualizadoEm)}</small>
            <button
              className="absolute right-1.5 top-1.5 rounded p-1 text-sm opacity-0 hover:bg-red-50 focus:opacity-70 group-hover:opacity-70"
              title="Excluir conversa"
              aria-label={`Excluir a conversa ${s.titulo}`}
              disabled={s.ocupada || apagar.isPending}
              onClick={(e) => { e.stopPropagation(); if (window.confirm(`Excluir a conversa "${s.titulo}"? Não dá para desfazer.`)) apagar.mutate(s.id); }}
            >
              🗑
            </button>
          </div>
        ))}
        <ErrorBox error={apagar.error} />
      </aside>
      {atual ? (
        <Chat key={atual} id={atual} estado={estado} aoApagar={() => setSel(null)} />
      ) : (
        <div className="card space-y-2 p-8 text-center">
          <p className="text-ink">Comece uma conversa. Por exemplo:</p>
          {SUGESTOES.map((t) => <p key={t} className="text-sm text-ink-soft">“{t}”</p>)}
          <button className="btn-primary mt-2" onClick={() => nova.mutate()}>Nova conversa</button>
        </div>
      )}
    </div>
  );
}

/** Anexo só sai com login: baixa com o token e mostra por um link local. */
function useAnexo(id: string, ligado = true) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ligado) return;
    let solto: string | null = null;
    fetch(`${BASE}/assistant/attachments/${id}`, { headers: comToken() })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) setUrl((solto = URL.createObjectURL(b))); })
      .catch(() => undefined);
    return () => { if (solto) URL.revokeObjectURL(solto); };
  }, [id, ligado]);
  return url;
}

function AnexoNaMensagem({ a, minha }: { a: AnexoInfo; minha: boolean }) {
  const imagem = a.mime.startsWith('image/');
  const url = useAnexo(a.id, imagem);
  const chip = `inline-flex max-w-[240px] items-center gap-1 truncate rounded-lg border px-2 py-1 text-xs ${minha ? 'border-white/30 bg-white/15 text-white' : 'border-slate-200 bg-white text-ink'}`;
  const abrir = async () => {
    const r = await fetch(`${BASE}/assistant/attachments/${a.id}`, { headers: comToken() });
    if (r.ok) window.open(URL.createObjectURL(await r.blob()), '_blank');
  };
  if (imagem) return url ? <img className="block max-h-36 max-w-[180px] cursor-zoom-in rounded-lg bg-white" src={url} alt={a.nome} title={a.nome} onClick={() => window.open(url, '_blank')} /> : <span className={chip}>{icone(a.mime)} {a.nome}</span>;
  return <button className={chip} title="Abrir" onClick={abrir}>{icone(a.mime)} {a.nome}</button>;
}

function Chat({ id, estado, aoApagar }: { id: string; estado: Estado; aoApagar: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const seletor = useRef<HTMLInputElement>(null);
  const [ouvir, setOuvir] = useState(() => { try { return localStorage.getItem(OUVIR) === '1'; } catch { return false; } });
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const faladas = useRef<Set<string> | null>(null);
  const conhecidas = useRef<Set<string> | null>(null);
  const [digitando, setDigitando] = useState<Set<string>>(() => new Set());
  const s = useQuery({
    queryKey: ['assistente', 'sessao', id],
    queryFn: () => api<Sessao>(`/assistant/sessions/${id}`),
    refetchInterval: (q) => {
      const d = q.state.data as Sessao | undefined;
      return d && (d.ocupada || d.acoes.some((a) => a.status === 'executando')) ? 1200 : false;
    },
  });
  const enviar = useMutation({
    mutationFn: (d: { texto: string; origem: 'texto' | 'voz'; anexos: string[] }) => api(`/assistant/sessions/${id}/messages`, { method: 'POST', json: d }),
    onSuccess: () => { setTexto(''); setPendentes((p) => { p.forEach((x) => x.previa && URL.revokeObjectURL(x.previa)); return []; }); qc.invalidateQueries({ queryKey: ['assistente', 'sessao', id] }); qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] }); },
  });
  const decidir = useMutation({
    mutationFn: (d: { acaoId: string; confirmar: boolean }) => api(`/assistant/actions/${d.acaoId}/${d.confirmar ? 'confirm' : 'cancel'}`, { method: 'POST', json: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['assistente', 'sessao', id] }),
  });
  const apagar = useMutation({ mutationFn: () => api(`/assistant/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] }); aoApagar(); } });
  const aprovacao = useMutation({ mutationFn: (modo: 'perguntar' | 'automatico') => api(`/assistant/sessions/${id}`, { method: 'PATCH', json: { aprovacao: modo } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['assistente', 'sessao', id] }) });
  const mudarAprovacao = (modo: 'perguntar' | 'automatico') => {
    if (modo === 'automatico' && !window.confirm('Aprovar automaticamente?\n\nNesta conversa, o assistente vai mandar mensagens, mudar preços, criar campanhas e lançar contas SEM pedir sua confirmação (sempre dentro das suas permissões). Você pode voltar para "Pedir aprovação" a qualquer momento.')) return;
    aprovacao.mutate(modo);
  };

  // Mensagens e ações na ordem em que aconteceram.
  const linha = useMemo(() => {
    if (!s.data) return [];
    const itens: ({ tipo: 'msg'; m: Mensagem } | { tipo: 'acao'; a: Acao })[] = [
      ...s.data.mensagens.filter((m) => m.origem !== 'sistema').map((m) => ({ tipo: 'msg' as const, m })),
      ...s.data.acoes.map((a) => ({ tipo: 'acao' as const, a })),
    ];
    return itens.sort((x, y) => (x.tipo === 'msg' ? x.m.criadoEm : x.a.criadoEm).localeCompare(y.tipo === 'msg' ? y.m.criadoEm : y.a.criadoEm));
  }, [s.data]);

  const ocupada = s.data?.ocupada;
  useEffect(() => {
    if (ocupada === false) qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] });
  }, [ocupada, qc]);

  // Respostas que chegam com a conversa aberta aparecem sendo digitadas (as antigas, não).
  useEffect(() => {
    if (!s.data) return;
    const ids = s.data.mensagens.filter((m) => m.papel === 'assistant' && m.origem !== 'sistema').map((m) => m.id);
    if (!conhecidas.current) {
      conhecidas.current = new Set(ids);
      return;
    }
    const novas = ids.filter((i) => !conhecidas.current!.has(i));
    if (!novas.length) return;
    novas.forEach((i) => conhecidas.current!.add(i));
    setDigitando((d) => new Set([...d, ...novas]));
  }, [s.data]);
  const terminouDeDigitar = (mid: string) => setDigitando((d) => { const n = new Set(d); n.delete(mid); return n; });
  const acompanhar = () => {
    const c = caixa.current;
    if (c && c.scrollHeight - c.scrollTop - c.clientHeight < 160) c.scrollTop = c.scrollHeight;
  };

  // Rola para o fim e, com "ouvir" ligado (ou se a pessoa falou), lê as respostas novas.
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (!s.data) return;
    const respostas = s.data.mensagens.filter((m) => m.papel === 'assistant');
    if (!faladas.current) {
      faladas.current = new Set(respostas.map((m) => m.id));
      return;
    }
    const novas = respostas.filter((m) => !faladas.current!.has(m.id));
    novas.forEach((m) => faladas.current!.add(m.id));
    const falouPorVoz = s.data.mensagens.filter((m) => m.papel === 'user' && (m.origem === 'voz' || m.origem === 'texto')).at(-1)?.origem === 'voz';
    if ((ouvir || falouPorVoz) && novas.length) void falar(novas.map((m) => m.fala ?? m.texto).join(' '), estado.vozResposta);
  }, [s.data, ouvir, estado.vozResposta]);

  const enviandoAnexo = pendentes.some((p) => !p.id && !p.erro);
  const prontos = pendentes.filter((p) => p.id).map((p) => p.id!);
  const mandar = (t: string, origem: 'texto' | 'voz') => {
    if ((!t.trim() && !prontos.length) || s.data?.ocupada || enviandoAnexo) return;
    enviar.mutate({ texto: t.trim(), origem, anexos: prontos });
  };

  /** Anexa arquivos (clipe, Ctrl+V ou arrastar): sobe na hora e mostra a prévia. */
  const adicionar = (arquivos: File[]) => {
    for (const f of arquivos.slice(0, 10 - pendentes.length)) {
      const chave = `${Date.now()}-${Math.random()}`;
      const nome = f.name && f.name !== 'image.png' ? f.name : `colado-${new Date().toLocaleTimeString('pt-BR').replace(/:/g, '')}.${(f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`;
      const item: Pendente = { chave, nome, mime: f.type, tamanho: f.size, previa: f.type.startsWith('image/') ? URL.createObjectURL(f) : null };
      if (f.size > 18_000_000) item.erro = 'Grande demais (máximo de 18 MB)';
      setPendentes((p) => [...p, item]);
      if (item.erro) continue;
      const leitor = new FileReader();
      leitor.onload = async () => {
        try {
          const r = await api<{ id: string; leitura: string }>('/assistant/attachments', { method: 'POST', json: { nome, mime: f.type, conteudo: String(leitor.result).split(',')[1] ?? '' } });
          setPendentes((p) => p.map((x) => (x.chave === chave ? { ...x, id: r.id, leitura: r.leitura } : x)));
        } catch (e) {
          setPendentes((p) => p.map((x) => (x.chave === chave ? { ...x, erro: (e as Error).message } : x)));
        }
      };
      leitor.onerror = () => setPendentes((p) => p.map((x) => (x.chave === chave ? { ...x, erro: 'Não consegui ler o arquivo.' } : x)));
      leitor.readAsDataURL(f);
    }
  };
  const tirar = (chave: string) => setPendentes((p) => p.filter((x) => { if (x.chave === chave && x.previa) URL.revokeObjectURL(x.previa); return x.chave !== chave; }));

  if (s.isLoading) return <Loading />;
  if (!s.data) return <ErrorBox error={s.error} />;
  const auto = s.data.aprovacao === 'automatico';
  return (
    <section
      className={`card flex h-[calc(100vh-210px)] min-h-[460px] flex-col overflow-hidden ${arrastando ? 'outline-dashed outline-[3px] -outline-offset-[6px] outline-brand' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionar([...e.dataTransfer.files]); }}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <b className="font-display text-base text-ink">{s.data.titulo}</b>
        <span className="flex-1" />
        <select
          className={`rounded-lg border px-2 py-1.5 text-xs ${auto ? 'border-amber-400 bg-amber-50 font-semibold text-amber-800' : 'border-slate-300 bg-white text-ink'}`}
          value={s.data.aprovacao}
          disabled={aprovacao.isPending}
          title={estado.podeAutomatico ? 'Como as ações que mandam mensagem ou alteram algo são aprovadas' : 'Só a gestão pode ligar a aprovação automática'}
          onChange={(e) => mudarAprovacao(e.target.value as 'perguntar' | 'automatico')}
        >
          <option value="perguntar">🛡 Pedir aprovação</option>
          <option value="automatico" disabled={!estado.podeAutomatico}>⚡ Aprovar automaticamente{estado.podeAutomatico ? '' : ' (sem permissão)'}</option>
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm text-ink-soft">
          <input type="checkbox" checked={ouvir} onChange={(e) => { setOuvir(e.target.checked); try { localStorage.setItem(OUVIR, e.target.checked ? '1' : '0'); } catch { /* sem armazenamento */ } if (!e.target.checked) calar(); }} /> Ouvir respostas
        </label>
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => window.confirm('Excluir esta conversa? Não dá para desfazer.') && apagar.mutate()} disabled={s.data.ocupada}>Excluir conversa</button>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-cream/40 p-4" ref={caixa}>
        {linha.length === 0 && (
          <div className="m-auto flex flex-wrap justify-center gap-2">
            {SUGESTOES.map((t) => <button key={t} className="btn-ghost whitespace-normal text-left" onClick={() => mandar(t, 'texto')}>{t}</button>)}
          </div>
        )}
        {linha.map((x) =>
          x.tipo === 'msg' ? (
            <div key={x.m.id} className={`relative max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed lg:max-w-[78%] ${x.m.papel === 'user' ? 'self-end rounded-br-md bg-brand text-white' : 'self-start rounded-bl-md border border-slate-200 bg-white text-ink'}`}>
              {x.m.anexos?.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1.5">{x.m.anexos.map((a) => <AnexoNaMensagem key={a.id} a={a} minha={x.m.papel === 'user'} />)}</div>}
              {x.m.origem === 'voz' && <span title="Falado">🎤 </span>}
              {x.m.papel === 'assistant' && digitando.has(x.m.id) ? <Digitado texto={x.m.texto} aoAvancar={acompanhar} aoTerminar={() => terminouDeDigitar(x.m.id)} /> : x.m.texto}
              {x.m.papel === 'assistant' && !digitando.has(x.m.id) && <button className="ml-1.5 text-xs opacity-50 hover:opacity-100" title="Ouvir" aria-label="Ouvir esta resposta" onClick={() => void falar(x.m.fala ?? x.m.texto, estado.vozResposta)}>🔊</button>}
            </div>
          ) : (
            <CartaoAcao key={x.a.id} a={x.a} decidir={(confirmar) => decidir.mutate({ acaoId: x.a.id, confirmar })} ocupado={decidir.isPending} />
          ),
        )}
        {s.data.ocupada && (
          <div className="inline-flex items-center gap-2.5 self-start rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5" aria-live="polite">
            <span className="inline-flex gap-1" aria-hidden="true">
              {[0, 150, 300].map((d) => <i key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-accent motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />)}
            </span>
            <span className="text-sm text-ink-soft">{estado.nome} está pensando…</span>
          </div>
        )}
        <ErrorBox error={decidir.error} />
        <div ref={fim} />
      </div>
      <div className="space-y-2 px-4 empty:hidden">
        <ErrorBox error={enviar.error} />
        <ErrorBox error={aprovacao.error} />
      </div>
      {auto && <div className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">⚡ Aprovação automática ligada: as ações são executadas sem pedir confirmação.</div>}
      {pendentes.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 pt-2">
          {pendentes.map((p) => (
            <div key={p.chave} className={`flex max-w-[280px] items-center gap-2 rounded-xl border p-1 pr-1.5 ${p.erro ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-cream'}`} title={p.erro ?? p.leitura ?? 'Enviando…'}>
              {p.previa ? <img src={p.previa} alt="" className="h-10 w-10 rounded-md object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-md bg-white text-xl">{icone(p.mime)}</span>}
              <div className="flex min-w-0 flex-col text-xs">
                <span className="truncate text-ink">{p.nome}</span>
                <small className="truncate text-[11px] text-ink-soft">{p.erro ? p.erro : p.id ? `${tamanhoLegivel(p.tamanho)} · ${p.leitura}` : 'enviando…'}</small>
              </div>
              <button className="px-1 text-ink-soft hover:text-ink" aria-label={`Tirar ${p.nome}`} onClick={() => tirar(p.chave)}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
        <input ref={seletor} type="file" multiple hidden accept="image/*,application/pdf,video/*,audio/*,.docx,.xlsx,.csv,.txt" onChange={(e) => { adicionar([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button className="btn-ghost px-3" title="Anexar arquivo (ou cole com Ctrl+V, ou arraste para cá)" aria-label="Anexar arquivo" disabled={pendentes.length >= 10} onClick={() => seletor.current?.click()}>📎</button>
        <textarea
          className="input flex-1 resize-none"
          onPaste={(e) => { const arquivos = [...e.clipboardData.files]; if (arquivos.length) { e.preventDefault(); adicionar(arquivos); } }}
          rows={2}
          value={texto}
          aria-label="Mensagem para o assistente"
          placeholder={s.data.ocupada ? 'Aguarde terminar…' : 'Escreva, fale ou cole/arraste arquivos (Ctrl+V)'}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandar(texto, 'texto'); } }}
        />
        {estado.voz && <Microfone desativado={s.data.ocupada || enviar.isPending} aoTranscrever={(t) => mandar(t, 'voz')} />}
        <button className="btn-primary" disabled={(!texto.trim() && !prontos.length) || s.data.ocupada || enviar.isPending || enviandoAnexo} onClick={() => mandar(texto, 'texto')}>Enviar</button>
      </div>
    </section>
  );
}

/** Resposta revelada como se estivesse sendo digitada; clique para mostrar tudo. */
function Digitado({ texto, aoAvancar, aoTerminar }: { texto: string; aoAvancar: () => void; aoTerminar: () => void }) {
  const [n, setN] = useState(0);
  const avancar = useRef(aoAvancar);
  const terminar = useRef(aoTerminar);
  avancar.current = aoAvancar;
  terminar.current = aoTerminar;
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      terminar.current();
      return;
    }
    const total = texto.length;
    const porSegundo = Math.max(90, total / 4);
    let inicio: number | null = null;
    let quadro = 0;
    const passo = (agora: number) => {
      inicio ??= agora;
      let alvo = Math.min(total, Math.floor(((agora - inicio) / 1000) * porSegundo));
      while (alvo < total && /\S/.test(texto[alvo] ?? '') && alvo > 0 && /\S/.test(texto[alvo - 1] ?? '')) alvo++;
      setN(alvo);
      avancar.current();
      if (alvo >= total) {
        terminar.current();
        return;
      }
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [texto]);
  return (
    <span onClick={() => terminar.current()} title="Clique para mostrar tudo">
      {texto.slice(0, n)}
      <span className="ml-0.5 inline-block h-[1.05em] w-[0.55em] animate-pulse rounded-sm bg-brand align-[-0.15em]" aria-hidden="true" />
    </span>
  );
}

const ETIQUETA: Record<string, string> = { concluida: 'bg-emerald-50 text-emerald-700', erro: 'bg-red-50 text-red-700', cancelada: 'bg-slate-100 text-slate-500', aguardando: 'bg-amber-50 text-amber-700', executando: 'bg-amber-50 text-amber-700' };
const BORDA: Record<string, string> = { concluida: 'border-l-emerald-500', erro: 'border-l-red-500', cancelada: 'border-l-slate-300 opacity-75', aguardando: 'border-l-brand-accent', executando: 'border-l-brand-accent' };

function CartaoAcao({ a, decidir, ocupado }: { a: Acao; decidir: (confirmar: boolean) => void; ocupado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const nome = ROTULO[a.ferramenta] ?? a.ferramenta;
  if (a.risco !== 'confirmar') {
    return (
      <div className={`self-start text-xs ${a.status === 'erro' ? 'text-red-600' : 'text-ink-soft'}`}>
        <button className="hover:underline" onClick={() => setAberto(!aberto)}>{a.status === 'executando' ? '⏳' : a.status === 'erro' ? '⚠️' : '✓'} {nome}</button>
        {a.erro && <span> {a.erro}</span>}
        {aberto && a.resultado != null && <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-2 text-[11px]">{JSON.stringify(a.resultado, null, 2).slice(0, 6000)}</pre>}
      </div>
    );
  }
  const previa = (Array.isArray(a.previa) ? a.previa : []) as { nome?: string; telefone?: string; texto?: string; problema?: string | null }[];
  const p = a.progresso;
  const resultado = a.resultado as { enviados?: number } | null;
  return (
    <div className={`card self-stretch border-l-4 px-4 py-3 ${BORDA[a.status] ?? ''}`}>
      <div className="flex items-center justify-between gap-2.5">
        <b className="text-sm text-ink">{nome}</b>
        <span className={`badge ${ETIQUETA[a.status] ?? 'bg-slate-100 text-slate-500'}`}>{{ aguardando: 'Esperando sua confirmação', executando: 'Executando', concluida: a.resumo?.includes('(aprovado automaticamente)') ? 'Concluída · automática' : 'Concluída', cancelada: 'Cancelada', erro: 'Erro' }[a.status] ?? a.status}</span>
      </div>
      {a.resumo && <p className="my-2 text-sm text-ink">{a.resumo}</p>}
      {previa.length > 0 && (
        <>
          <button className="text-sm text-brand hover:underline" onClick={() => setAberto(!aberto)}>{aberto ? 'Esconder' : 'Ver'} {previa.length === 1 ? 'os detalhes' : `os ${previa.length} itens`}</button>
          {aberto && (
            <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-auto border-t border-slate-200 pt-2 text-sm">
              {previa.slice(0, 100).map((i, n) => (
                <div key={n} className={i.problema ? 'opacity-70' : ''}>
                  <b>{i.nome ?? i.telefone}</b> {i.telefone && i.nome && <span className="text-ink-soft">{i.telefone}</span>}
                  {i.problema ? <div className="text-red-600">Fica de fora: {i.problema}</div> : <div className="whitespace-pre-wrap text-ink-soft">{i.texto}</div>}
                </div>
              ))}
              {previa.length > 100 && <p className="text-ink-soft">e mais {previa.length - 100}…</p>}
            </div>
          )}
        </>
      )}
      {p && p.total > 0 && (
        <div className="my-2">
          <div className="h-2 overflow-hidden rounded-full bg-cream"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((p.feitos / p.total) * 100)}%` }} /></div>
          <small className="text-xs text-ink-soft">{p.feitos} de {p.total}{p.falhas ? ` · ${p.falhas} falha(s)` : ''}</small>
        </div>
      )}
      {a.status === 'concluida' && typeof resultado?.enviados === 'number' && <p className="text-sm text-ink-soft">{resultado.enviados} enviada(s).</p>}
      {a.erro && <p className="text-sm text-red-600">{a.erro}</p>}
      {a.status === 'aguardando' && (
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <button className="btn-primary" disabled={ocupado} onClick={() => decidir(true)}>Confirmar</button>
          <button className="btn-ghost" disabled={ocupado} onClick={() => decidir(false)}>Cancelar</button>
          <small className="text-xs text-ink-soft">ou fale “pode” / “cancela”</small>
        </div>
      )}
    </div>
  );
}

/** Grava pelo microfone, transcreve no servidor e entrega o texto. */
function Microfone({ desativado, aoTranscrever }: { desativado: boolean; aoTranscrever: (t: string) => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const iniciar = async () => {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      partes.current = [];
      r.ondataavailable = (e) => { if (e.data.size) partes.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(partes.current, { type: r.mimeType || 'audio/webm' });
        if (blob.size < 1500) return;
        setTranscrevendo(true);
        try {
          const b64 = await new Promise<string>((ok, falha) => {
            const f = new FileReader();
            f.onload = () => ok(String(f.result).split(',')[1] ?? '');
            f.onerror = () => falha(f.error);
            f.readAsDataURL(blob);
          });
          const { texto } = await api<{ texto: string }>('/assistant/transcribe', { method: 'POST', json: { audio: b64, mime: blob.type } });
          if (texto.trim()) aoTranscrever(texto);
        } catch (e) {
          setErro(e);
        } finally {
          setTranscrevendo(false);
        }
      };
      r.start();
      rec.current = r;
      setGravando(true);
    } catch {
      setErro(new Error('Não consegui usar o microfone. Libere o acesso no navegador.'));
    }
  };
  const parar = () => {
    rec.current?.stop();
    rec.current = null;
    setGravando(false);
  };
  return (
    <div className="flex flex-col gap-1">
      <button className={gravando ? 'btn animate-pulse bg-red-600 text-white' : 'btn-ghost'} disabled={desativado || transcrevendo} onClick={gravando ? parar : iniciar} title={gravando ? 'Parar e enviar' : 'Falar'}>
        {transcrevendo ? '…' : gravando ? '■ Parar' : '🎤 Falar'}
      </button>
      <ErrorBox error={erro} />
    </div>
  );
}

// ───────────── Agentes agendados ─────────────

function Agentes({ abrir, podeAutomatico }: { abrir: (sessaoId: string) => void; podeAutomatico: boolean }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['assistente', 'rotinas'], queryFn: () => api<Rotina[]>('/assistant/routines'), refetchInterval: 15_000 });
  const criar = useMutation({
    mutationFn: async (pedido: string) => {
      const s = await api<{ id: string }>('/assistant/sessions', { method: 'POST', json: {} });
      await api(`/assistant/sessions/${s.id}/messages`, { method: 'POST', json: { texto: pedido } });
      return s.id;
    },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] }); abrir(id); },
  });
  const atualizar = () => { qc.invalidateQueries({ queryKey: ['assistente', 'rotinas'] }); qc.invalidateQueries({ queryKey: ['assistente', 'sessoes'] }); };
  const acao = useMutation({
    mutationFn: (d: { r: Rotina; o: 'rodar' | 'duplicar' | 'pausar' | 'retomar' | 'excluir' | 'automatico' | 'perguntar' }) =>
      d.o === 'automatico' || d.o === 'perguntar'
        ? api(`/assistant/routines/${d.r.id}`, { method: 'PATCH', json: { aprovacao: d.o } })
        : d.o === 'rodar'
          ? api(`/assistant/routines/${d.r.id}/run`, { method: 'POST', json: {} })
          : d.o === 'duplicar'
            ? api(`/assistant/routines/${d.r.id}/duplicate`, { method: 'POST', json: {} })
            : d.o === 'excluir'
              ? api(`/assistant/routines/${d.r.id}`, { method: 'DELETE' })
              : api(`/assistant/routines/${d.r.id}`, { method: 'PATCH', json: { ativa: d.o === 'retomar' } }),
    onSuccess: atualizar,
  });
  if (lista.isLoading) return <Loading />;
  const rs = lista.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-soft">{rs.length} agente(s) agendado(s) · trabalham sozinhos no horário ou a cada X tempo, com as suas permissões</span>
        <span className="flex-1" />
        <button className="btn-ghost" disabled={criar.isPending} onClick={() => criar.mutate('Quero criar um agente agendado (uma rotina que trabalha sozinha). Me ajuda a montar?')}>+ Agente agendado</button>
      </div>
      <ErrorBox error={criar.error} />
      {!rs.length && <div className="card p-8 text-center text-sm text-ink-soft">Nenhum agente agendado ainda. Peça na conversa, por exemplo: “todo dia às 20h me manda por e-mail o resumo do dia” ou “toda segunda às 8h veja o que preciso comprar e monte os pedidos de compra”.</div>}
      {rs.map((r) => (
        <div key={r.id} className={`card space-y-2 p-4 ${r.ativa ? '' : 'opacity-70'}`}>
          <div className="flex items-start justify-between gap-2.5">
            <div>
              <b className="text-ink">{r.titulo}</b>
              <div className="text-sm text-ink-soft">{r.quando}{r.emails.length ? ` · e-mail para ${r.emails.join(', ')}` : ''}</div>
            </div>
            <span className="flex gap-1">
              {r.aprovacao === 'automatico' && <span className="badge bg-amber-50 text-amber-700" title="Executa tudo sem esperar confirmação">⚡ Automática</span>}
              <span className={`badge ${r.ativa ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.ativa ? 'Ativa' : 'Pausada'}</span>
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-ink-soft">{r.instrucao}</p>
          <div className="text-xs text-ink-soft">
            {r.ativa && <>Próxima: {formatDateTime(r.proximaEm)} · </>}
            {r.ultimaEm ? <>Última: {formatDateTime(r.ultimaEm)}{r.ultimaSessaoId && <> · <button className="text-brand underline" onClick={() => abrir(r.ultimaSessaoId!)}>ver o que ele fez</button></>}</> : 'Ainda não rodou'}
          </div>
          {r.ultimoErro && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{r.ultimoErro}</div>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={acao.isPending} onClick={() => acao.mutate({ r, o: 'rodar' })}>Rodar agora</button>
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={acao.isPending} onClick={() => acao.mutate({ r, o: 'duplicar' })}>Duplicar</button>
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={acao.isPending} onClick={() => acao.mutate({ r, o: r.ativa ? 'pausar' : 'retomar' })}>{r.ativa ? 'Pausar' : 'Retomar'}</button>
            <select
              className={`rounded-lg border px-2 py-1.5 text-xs ${r.aprovacao === 'automatico' ? 'border-amber-400 bg-amber-50 font-semibold text-amber-800' : 'border-slate-300 bg-white'}`}
              value={r.aprovacao}
              disabled={acao.isPending}
              aria-label="Aprovação das ações"
              onChange={(e) => {
                const o = e.target.value as 'perguntar' | 'automatico';
                if (o === 'automatico' && !window.confirm(`Aprovar automaticamente a rotina "${r.titulo}"?\n\nEla vai mandar WhatsApp, mudar preços e o que a instrução pedir, sozinha, sem esperar sua confirmação.`)) return;
                acao.mutate({ r, o });
              }}
            >
              <option value="perguntar">🛡 Pedir aprovação</option>
              <option value="automatico" disabled={!podeAutomatico}>⚡ Aprovar automaticamente{podeAutomatico ? '' : ' (sem permissão)'}</option>
            </select>
            <button className="btn px-3 py-1.5 text-xs text-red-700 hover:bg-red-50" disabled={acao.isPending} onClick={() => window.confirm(`Excluir a rotina "${r.titulo}"?`) && acao.mutate({ r, o: 'excluir' })}>Excluir</button>
          </div>
        </div>
      ))}
      <ErrorBox error={acao.error} />
      {rs.length > 0 && <p className="text-sm text-ink-soft">Para mudar horário, intervalo, dias ou o que o agente faz, peça na conversa (ex.: “muda o resumo do dia para dias úteis às 19h”). A cópia nasce pausada para você ajustar.</p>}
    </div>
  );
}

// ───────────── Pedidos ─────────────

function Pedidos({ podeMudar }: { podeMudar: boolean }) {
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['assistente', 'pedidos'], queryFn: () => api<PedidoEquipe[]>('/assistant/requests') });
  const mudar = useMutation({ mutationFn: (d: { id: string; status: string }) => api(`/assistant/requests/${d.id}`, { method: 'PATCH', json: { status: d.status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['assistente', 'pedidos'] }) });
  const [sel, setSel] = useState<string | null>(null);
  if (lista.isLoading) return <Loading />;
  if (!lista.data?.length) return <div className="card p-8 text-center text-sm text-ink-soft">Nenhum pedido ainda. Quando você pedir algo que o sistema ainda não faz, o assistente monta a especificação e o plano e registra aqui para a equipe da Wide.</div>;
  const p = sel ? lista.data.find((x) => x.id === sel) : null;
  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Nº</th><th>Pedido</th><th>Tipo</th><th>Quem pediu</th><th>Data</th><th>Situação</th></tr></thead>
          <tbody>
            {lista.data.map((x) => {
              const [k, t] = STATUS_PEDIDO[x.status] ?? ['bg-slate-100 text-slate-500', x.status];
              return (
                <tr key={x.id} className="cursor-pointer hover:bg-cream/60" onClick={() => setSel(sel === x.id ? null : x.id)}>
                  <td><b>{x.numero}</b></td>
                  <td>{x.titulo}</td>
                  <td>{x.tipo === 'configurar' ? 'Configuração' : 'Desenvolvimento'}</td>
                  <td>{x.autor ?? '—'}</td>
                  <td>{formatDateTime(x.criadoEm)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {podeMudar ? (
                      <select className="input w-auto py-1 text-xs" aria-label="Situação" value={x.status} onChange={(e) => mudar.mutate({ id: x.id, status: e.target.value })}>{Object.entries(STATUS_PEDIDO).map(([v, [, r]]) => <option key={v} value={v}>{r}</option>)}</select>
                    ) : <span className={`badge ${k}`}>{t}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {p && (
        <div className="card space-y-2 p-5">
          <h3 className="font-display text-lg text-ink">Pedido nº {p.numero}: {p.titulo}</h3>
          <p className="whitespace-pre-wrap text-sm text-ink">{p.especificacao}</p>
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Plano</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">{(p.plano ?? []).map((x, i) => <li key={i}>{x}</li>)}</ol>
        </div>
      )}
      <ErrorBox error={mudar.error} />
    </div>
  );
}

// ───────────── Configurar ─────────────

interface ConfigTela { nome: string; instrucoes: string; aprovacaoAutomatica: 'gestao' | 'todos' | 'ninguem'; voz: 'automatica' | 'elevenlabs' | 'openai' | 'navegador'; vozElevenlabs: string; vozOpenai: string }
interface ConfigResposta extends ConfigTela { opcoes: { elevenlabs: { id: string; nome: string }[]; openai: { id: string; nome: string }[] }; chaves: { elevenlabs: boolean; openai: boolean } }

function Configurar() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['assistente', 'config'], queryFn: () => api<ConfigResposta>('/assistant/config') });
  const [f, setF] = useState<ConfigTela | null>(null);
  const [outra, setOutra] = useState(false);
  const [exemplo, setExemplo] = useState<{ tocando: boolean; erro: unknown }>({ tocando: false, erro: null });
  const salvar = useMutation({ mutationFn: (d: ConfigTela) => api('/assistant/config', { method: 'PUT', json: d }), onSuccess: () => qc.invalidateQueries({ queryKey: ['assistente'] }) });
  if (cfg.isLoading) return <Loading />;
  if (!cfg.data) return <ErrorBox error={cfg.error} />;
  const c = cfg.data;
  const v: ConfigTela = f ?? { nome: c.nome, instrucoes: c.instrucoes, aprovacaoAutomatica: c.aprovacaoAutomatica, voz: c.voz, vozElevenlabs: c.vozElevenlabs, vozOpenai: c.vozOpenai };
  const provedor = v.voz === 'automatica' ? (c.chaves.elevenlabs ? 'elevenlabs' : c.chaves.openai ? 'openai' : 'navegador') : v.voz;
  const personalizada = outra || !c.opcoes.elevenlabs.some((o) => o.id === v.vozElevenlabs);
  const ouvirExemplo = async () => {
    setExemplo({ tocando: true, erro: null });
    try {
      const texto = `Oi! Eu sou ${v.nome || 'o assistente'}. Este mês as vendas subiram doze por cento em relação ao mês passado, e temos vinte e três clientes que não compram há mais de quarenta e cinco dias. Quer que eu mande uma mensagem lembrando do cashback delas?`;
      if (provedor === 'navegador') falarNoNavegador(texto);
      else await falar(texto, provedor, { provedor, voz: provedor === 'elevenlabs' ? v.vozElevenlabs : v.vozOpenai });
      setExemplo({ tocando: false, erro: null });
    } catch (e) {
      setExemplo({ tocando: false, erro: e });
    }
  };
  return (
    <div className="card max-w-3xl space-y-5 p-6">
      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Identidade</h2>
        <Field label="Nome do assistente" hint="O nome com que ele se apresenta para a equipe (ex.: Sol).">
          <input className="input max-w-sm" value={v.nome} onChange={(e) => setF({ ...v, nome: e.target.value })} placeholder="Ex.: Sol" />
        </Field>
        <Field label="Orientações da loja" hint="Tom, prioridades e o que ele nunca deve fazer. Ex.: “Nunca dê desconto acima de 15%”, “Sempre ofereça o kit do mês para quem sumiu”.">
          <textarea className="input" rows={6} value={v.instrucoes} onChange={(e) => setF({ ...v, instrucoes: e.target.value })} />
        </Field>
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Aprovação das ações</h2>
        <Field label="Quem pode usar “Aprovar automaticamente”" hint="No modo automático, o assistente manda mensagens, muda preços e cria campanhas sem pedir confirmação (sempre dentro das permissões de quem pediu). Cada pessoa liga ou desliga na conversa e em cada agente agendado.">
          <select className="input max-w-sm" value={v.aprovacaoAutomatica} onChange={(e) => setF({ ...v, aprovacaoAutomatica: e.target.value as ConfigTela['aprovacaoAutomatica'] })}>
            <option value="gestao">Só a gestão (quem configura a loja)</option>
            <option value="todos">Todos que usam o Assistente</option>
            <option value="ninguem">Ninguém (sempre pede confirmação)</option>
          </select>
        </Field>
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-lg text-ink">Voz das respostas</h2>
        <Field label="Quem fala">
          <select className="input max-w-sm" value={v.voz} onChange={(e) => setF({ ...v, voz: e.target.value as ConfigTela['voz'] })}>
            <option value="automatica">Automática (a melhor disponível)</option>
            <option value="elevenlabs" disabled={!c.chaves.elevenlabs}>ElevenLabs (mais natural){c.chaves.elevenlabs ? '' : ' · falta a chave'}</option>
            <option value="openai" disabled={!c.chaves.openai}>OpenAI{c.chaves.openai ? '' : ' · falta a chave'}</option>
            <option value="navegador">Voz do navegador (grátis, robótica)</option>
          </select>
        </Field>
        {provedor === 'elevenlabs' && (
          <Field label="Voz da ElevenLabs" hint={personalizada ? 'Cole o Voice ID (ElevenLabs › Voices › a voz › copiar ID).' : undefined}>
            {personalizada ? (
              <div className="flex max-w-md gap-2">
                <input className="input" value={v.vozElevenlabs} onChange={(e) => setF({ ...v, vozElevenlabs: e.target.value.trim() })} placeholder="Voice ID" />
                <button className="btn-ghost whitespace-nowrap" onClick={() => { setOutra(false); setF({ ...v, vozElevenlabs: c.opcoes.elevenlabs[0]!.id }); }}>Voltar à lista</button>
              </div>
            ) : (
              <select className="input max-w-sm" value={v.vozElevenlabs} onChange={(e) => (e.target.value === '__outra' ? setOutra(true) : setF({ ...v, vozElevenlabs: e.target.value }))}>
                {c.opcoes.elevenlabs.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                <option value="__outra">Outra voz (colar o ID)…</option>
              </select>
            )}
          </Field>
        )}
        {provedor === 'openai' && (
          <Field label="Voz da OpenAI">
            <select className="input max-w-sm" value={v.vozOpenai} onChange={(e) => setF({ ...v, vozOpenai: e.target.value })}>{c.opcoes.openai.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select>
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" disabled={exemplo.tocando} onClick={ouvirExemplo}>{exemplo.tocando ? 'Gerando…' : '🔊 Ouvir exemplo'}</button>
          {!c.chaves.elevenlabs && <small className="text-xs text-ink-soft">Para a voz mais natural, coloque a chave da ElevenLabs (ELEVENLABS_API_KEY) no servidor.</small>}
        </div>
        <ErrorBox error={exemplo.erro} />
      </section>
      <p className="text-sm text-ink-soft">Ele só faz o que o usuário logado pode fazer (as mesmas permissões das telas). Mensagens, preços, campanhas, compras e contas passam pela confirmação de quem pediu. O espaço entre mensagens do envio em lote é a chave ASSISTENTE_INTERVALO_LOTE_S (padrão: 20 segundos).</p>
      <ErrorBox error={salvar.error} />
      {salvar.isSuccess && !f && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Salvo.</div>}
      <button className="btn-primary" disabled={salvar.isPending || !v.nome.trim()} onClick={() => salvar.mutate(v, { onSuccess: () => { setF(null); setOutra(false); } })}>Salvar</button>
    </div>
  );
}
