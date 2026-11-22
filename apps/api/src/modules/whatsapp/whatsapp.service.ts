import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatMoney, normalizePhone, productPath } from '@mercearia/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { currentContext, type RequestContext } from '../../common/tenancy/request-context';
import { WhatsappSender, type SendMeta } from '../notify/whatsapp.sender';
import { phoneVariants, type Inbound, type SendResult, type StatusUpdate } from '../notify/whatsapp.provider';
import { ShopService } from '../shop/shop.service';
import { WA_PADRAO, waConfigSchema, type WaConfig } from './whatsapp.config';

const MIDIA: Record<string, string> = { imagem: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', documento: '📄 Documento', localizacao: '📍 Localização', figurinha: 'Figurinha', contato: '👤 Contato' };
const JANELA_MS = 24 * 3_600_000;
const publicUrl = () => (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type Filtro = 'abertas' | 'minhas' | 'equipe' | 'ia' | 'resolvidas' | 'todas';

/**
 * Atendimento no WhatsApp: conversas por cliente, mensagens que entram e saem (da equipe, da IA e do sistema),
 * carrinho por link e o gatilho do agente de IA. Uma conversa por telefone.
 */
@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly log = new Logger('Atendimento');
  /** Chamado quando chega mensagem de cliente (o agente de IA se registra aqui). */
  onInbound?: (tenantId: string, slug: string, conversationId: string) => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsappSender,
    private readonly shop: ShopService,
  ) {}

  onModuleInit() {
    // Tudo que o sistema manda pelo WhatsApp (assistente, avisos) aparece na conversa.
    this.sender.onSent = (phone, text, result, meta) => this.anotarEnvio(phone, text, result, meta);
  }

  get canal() {
    const p = this.sender.provider;
    return { ligado: !!p, provedor: p?.kind ?? null, janela24h: !!p?.janela24h, modelos: !!p?.sendTemplate };
  }

  // ───────────── Configuração ─────────────

  async config(tenantId: string): Promise<WaConfig> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId }, select: { whatsappConfig: true } });
    return { ...WA_PADRAO, ...((s?.whatsappConfig as Partial<WaConfig> | null) ?? {}) };
  }

  async salvarConfig(tenantId: string, input: unknown) {
    const d = waConfigSchema.parse(input);
    await this.prisma.tenantSetting.upsert({ where: { tenantId }, create: { tenantId, whatsappConfig: d }, update: { whatsappConfig: d } });
    return d;
  }

  // ───────────── Entrada (webhook) ─────────────

  private async acharConversa(tenantId: string, phone: string) {
    return this.prisma.waConversation.findFirst({ where: { tenantId, phone: { in: phoneVariants(phone) } } });
  }

  private async acharCliente(tenantId: string, phone: string) {
    return this.prisma.customer.findFirst({ where: { tenantId, active: true, phone: { in: phoneVariants(phone) } }, select: { id: true, name: true } });
  }

  private async conversaPara(tenantId: string, phone: string, nome: string | null) {
    const existente = await this.acharConversa(tenantId, phone);
    if (existente) return existente;
    const cliente = await this.acharCliente(tenantId, phone);
    try {
      return await this.prisma.waConversation.create({ data: { tenantId, phone, name: cliente?.name ?? nome, customerId: cliente?.id ?? null } });
    } catch (e) {
      // Duas mensagens ao mesmo tempo criando a mesma conversa.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return (await this.acharConversa(tenantId, phone))!;
      throw e;
    }
  }

  /** Mensagens que chegaram pelo webhook do provedor. */
  async receber(slug: string, entrada: { messages: Inbound[]; statuses: StatusUpdate[] }) {
    const t = await this.shop.tenant(slug);
    const cfg = await this.config(t.tenantId);
    let novas = 0;
    for (const m of entrada.messages) {
      const conv = await this.conversaPara(t.tenantId, m.phone, m.fromMe ? null : m.name);
      const texto = m.text || (m.media ? MIDIA[m.media] ?? m.media : '');
      try {
        await this.prisma.waMessage.create({
          data: { tenantId: t.tenantId, conversationId: conv.id, direction: m.fromMe ? 'out' : 'in', author: m.fromMe ? 'equipe' : 'cliente', text: texto, media: m.media, externalId: m.externalId, status: m.fromMe ? 'enviada' : 'recebida' },
        });
      } catch (e) {
        // Já registrada (o provedor reenviou, ou é o eco de uma mensagem que o próprio sistema mandou).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
      const agora = new Date();
      if (m.fromMe) {
        // Alguém da equipe respondeu pelo celular da loja.
        await this.prisma.waConversation.update({ where: { id: conv.id }, data: { lastMessageAt: agora, lastPreview: texto.slice(0, 120), aiReplies: 0, needsHuman: false, ...(cfg.pausarQuandoEquipeResponde ? { aiEnabled: false } : {}) } });
        continue;
      }
      await this.prisma.waConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: agora, lastInboundAt: agora, lastPreview: texto.slice(0, 120), unread: { increment: 1 }, status: 'aberta', ...(m.name && !conv.customerId ? { name: m.name.slice(0, 80) } : {}) },
      });
      novas++;
      this.onInbound?.(t.tenantId, slug, conv.id);
    }
    for (const s of entrada.statuses) {
      await this.prisma.waMessage.updateMany({ where: { tenantId: t.tenantId, externalId: s.externalId }, data: { status: s.failed ? 'falhou' : 'enviada', error: s.error } });
    }
    return { recebidas: novas };
  }

  /** O que o sistema mandou (pela tela, pela IA ou pelo assistente) entra na conversa. */
  private async anotarEnvio(phone: string, text: string, r: SendResult, meta: SendMeta) {
    const tenantId = meta.tenantId ?? currentContext()?.tenantId;
    if (!tenantId) return;
    const conv = await this.conversaPara(tenantId, phone, null);
    const agora = new Date();
    await this.prisma.waMessage.create({
      data: { tenantId, conversationId: conv.id, direction: 'out', author: meta.author ?? 'sistema', userId: meta.userId ?? currentContext()?.userId ?? null, text, externalId: r.ok ? (r.externalId ?? null) : null, status: r.ok ? 'enviada' : 'falhou', error: r.ok ? null : r.reason },
    }).catch((e) => {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    });
    await this.prisma.waConversation.update({ where: { id: conv.id }, data: { lastMessageAt: agora, lastPreview: text.slice(0, 120) } });
  }

  // ───────────── Tela de atendimento ─────────────

  async listar(ctx: RequestContext, filtro: Filtro = 'abertas', busca?: string) {
    const where: Prisma.WaConversationWhereInput = { tenantId: ctx.tenantId };
    if (filtro === 'abertas') where.status = 'aberta';
    if (filtro === 'resolvidas') where.status = 'resolvida';
    if (filtro === 'minhas') Object.assign(where, { status: 'aberta', assignedTo: ctx.userId });
    if (filtro === 'equipe') Object.assign(where, { status: 'aberta', OR: [{ needsHuman: true }, { aiEnabled: false }] });
    if (filtro === 'ia') Object.assign(where, { status: 'aberta', aiEnabled: true, needsHuman: false });
    const b = busca?.trim();
    if (b) {
      const d = b.replace(/\D/g, '');
      where.AND = [{ OR: [{ name: { contains: b, mode: 'insensitive' } }, ...(d.length >= 4 ? [{ phone: { contains: d } }] : [])] }];
    }
    const cs = await this.prisma.waConversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, take: 100 });
    const agora = Date.now();
    return cs.map((c) => ({ ...this.resumo(c, agora) }));
  }

  private resumo(c: Prisma.WaConversationGetPayload<object>, agora = Date.now()) {
    return {
      id: c.id,
      phone: c.phone,
      name: c.name,
      customerId: c.customerId,
      status: c.status,
      assignedTo: c.assignedTo,
      aiEnabled: c.aiEnabled,
      needsHuman: c.needsHuman,
      unread: c.unread,
      lastMessageAt: c.lastMessageAt,
      lastPreview: c.lastPreview,
      /** API oficial: dá para mandar texto livre (a cliente escreveu nas últimas 24 h). */
      janelaAberta: !this.sender.provider?.janela24h || (!!c.lastInboundAt && agora - c.lastInboundAt.getTime() < JANELA_MS),
      janelaFechaEm: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + JANELA_MS) : null,
    };
  }

  private async minha(ctx: RequestContext, id: string) {
    const c = await this.prisma.waConversation.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    return c;
  }

  async abrir(ctx: RequestContext, id: string) {
    const c = await this.minha(ctx, id);
    if (c.unread) await this.prisma.waConversation.update({ where: { id }, data: { unread: 0 } });
    const msgs = await this.prisma.waMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const usuarios = await this.prisma.appUser.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(msgs.map((m) => m.userId).filter((x): x is string => !!x)), ...(c.assignedTo ? [c.assignedTo] : [])] } }, select: { id: true, name: true } });
    const nome = new Map(usuarios.map((u) => [u.id, u.name]));
    const cliente = c.customerId
      ? await this.prisma.customer.findFirst({ where: { id: c.customerId, tenantId: ctx.tenantId }, select: { id: true, name: true, isMember: true, cashbackBalance: true, memberCode: true, allowWhatsapp: true } })
      : null;
    return {
      ...this.resumo({ ...c, unread: 0 }),
      assignedName: c.assignedTo ? (nome.get(c.assignedTo) ?? null) : null,
      customer: cliente ? { id: cliente.id, name: cliente.name, isMember: cliente.isMember, cashback: Number(cliente.cashbackBalance), memberCode: cliente.memberCode, allowWhatsapp: cliente.allowWhatsapp } : null,
      messages: msgs.reverse().map((m) => ({ id: m.id, direction: m.direction, author: m.author, userName: m.userId ? (nome.get(m.userId) ?? null) : null, text: m.text, media: m.media, status: m.status, error: m.error, createdAt: m.createdAt })),
    };
  }

  /** Mensagem da equipe pela tela. */
  async enviar(ctx: RequestContext, id: string, texto: string) {
    const c = await this.minha(ctx, id);
    if (!this.sender.enabled) throw new BadRequestException('O WhatsApp não está conectado no servidor.');
    if (!this.resumo(c).janelaAberta) throw new BadRequestException('Passou de 24 h desde a última mensagem da cliente: pela API oficial, só dá para mandar um modelo aprovado.');
    const r = await this.sender.sendText(c.phone, texto, { tenantId: ctx.tenantId, author: 'equipe', userId: ctx.userId });
    await this.equipeEntrou(ctx, c.id);
    if (!r.ok) throw new BadRequestException(r.reason);
    return { ok: true };
  }

  async enviarModelo(ctx: RequestContext, id: string, d: { nome: string; idioma: string; parametros: string[] }) {
    const c = await this.minha(ctx, id);
    const p = this.sender.provider;
    if (!p?.sendTemplate) throw new BadRequestException('Modelos só existem na API oficial do WhatsApp.');
    const r = await p.sendTemplate(c.phone, d.nome, d.idioma, d.parametros);
    const texto = `📋 Modelo "${d.nome}"${d.parametros.length ? `: ${d.parametros.join(' · ')}` : ''}`;
    await this.prisma.waMessage.create({ data: { tenantId: ctx.tenantId, conversationId: c.id, direction: 'out', author: 'equipe', userId: ctx.userId, text: texto, externalId: r.ok ? (r.externalId ?? null) : null, status: r.ok ? 'enviada' : 'falhou', error: r.ok ? null : r.reason } });
    await this.prisma.waConversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date(), lastPreview: texto.slice(0, 120) } });
    await this.equipeEntrou(ctx, c.id);
    if (!r.ok) throw new BadRequestException(r.reason);
    return { ok: true };
  }

  private async equipeEntrou(ctx: RequestContext, id: string) {
    const cfg = await this.config(ctx.tenantId);
    await this.prisma.waConversation.update({ where: { id }, data: { aiReplies: 0, needsHuman: false, ...(cfg.pausarQuandoEquipeResponde ? { aiEnabled: false } : {}) } });
  }

  async mudar(ctx: RequestContext, id: string, d: { status?: 'aberta' | 'resolvida'; aiEnabled?: boolean; assumir?: boolean; customerId?: string | null }) {
    const c = await this.minha(ctx, id);
    const data: Prisma.WaConversationUpdateInput = {};
    if (d.status) data.status = d.status;
    if (d.aiEnabled !== undefined) Object.assign(data, { aiEnabled: d.aiEnabled, ...(d.aiEnabled ? { aiReplies: 0, needsHuman: false } : {}) });
    if (d.assumir !== undefined) data.assignedTo = d.assumir ? ctx.userId : null;
    if (d.customerId !== undefined) {
      if (d.customerId) {
        const cl = await this.prisma.customer.findFirst({ where: { id: d.customerId, tenantId: ctx.tenantId }, select: { id: true, name: true } });
        if (!cl) throw new NotFoundException('Cliente não encontrada.');
        Object.assign(data, { customerId: cl.id, name: cl.name });
      } else data.customerId = null;
    }
    await this.prisma.waConversation.update({ where: { id: c.id }, data });
    return this.abrir(ctx, id);
  }

  /** Começa (ou abre) a conversa com um telefone ou uma cliente cadastrada. */
  async iniciar(ctx: RequestContext, d: { customerId?: string; phone?: string }) {
    let phone = d.phone ? normalizePhone(d.phone) : null;
    let nome: string | null = null;
    if (d.customerId) {
      const cl = await this.prisma.customer.findFirst({ where: { id: d.customerId, tenantId: ctx.tenantId }, select: { phone: true, name: true } });
      if (!cl?.phone) throw new BadRequestException('A cliente não tem celular cadastrado.');
      phone = normalizePhone(cl.phone);
      nome = cl.name;
    }
    if (!phone) throw new BadRequestException('Celular inválido.');
    const c = await this.conversaPara(ctx.tenantId, phone, nome);
    return { id: c.id };
  }

  // ───────────── Carrinho por link ─────────────

  /** Monta o carrinho (produtos do app) e devolve o link da loja online que já abre com ele. */
  async criarCarrinho(tenantId: string, slug: string, itens: Array<{ productId: string; quantity: number }>, conversationId?: string | null) {
    const catalogo = await this.shop.catalog(slug);
    const porId = new Map(catalogo.products.map((p) => [p.id, p]));
    const linhas = itens.map((i) => ({ p: porId.get(i.productId), q: Math.max(1, Math.min(50, Math.round(i.quantity))) }));
    const faltam = itens.filter((_, n) => !linhas[n]!.p);
    if (faltam.length) throw new BadRequestException('Produto fora do app ou inativo.');
    const indisponiveis = linhas.filter((l) => !l.p!.available).map((l) => l.p!.name);
    const id = randomBytes(9).toString('base64url');
    await this.prisma.waCart.create({ data: { id, tenantId, conversationId: conversationId ?? null, items: linhas.map((l) => ({ productId: l.p!.id, quantity: l.q })), expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    const preco = (l: (typeof linhas)[number], membro: boolean) => (l.p!.offer && (!l.p!.offer.membersOnly || membro) ? Math.min(l.p!.offer.price, membro ? l.p!.memberPrice : l.p!.price) : membro ? l.p!.memberPrice : l.p!.price) * l.q;
    const total = linhas.reduce((s, l) => s + preco(l, false), 0);
    const totalMembro = linhas.reduce((s, l) => s + preco(l, true), 0);
    return {
      link: `${publicUrl()}/loja?c=${id}`,
      itens: linhas.map((l) => `${l.q}× ${l.p!.name}`),
      total: formatMoney(total),
      totalMembro: formatMoney(totalMembro),
      indisponiveis,
    };
  }

  /** A loja online pede os itens do carrinho do link. */
  async carrinho(slug: string, id: string) {
    const t = await this.shop.tenant(slug);
    const c = await this.prisma.waCart.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!c || c.expiresAt < new Date()) throw new NotFoundException('Esse link de carrinho venceu. Peça outro no WhatsApp.');
    return { items: c.items as Array<{ productId: string; quantity: number }> };
  }

  async enviarCarrinho(ctx: RequestContext, id: string, itens: Array<{ productId: string; quantity: number }>) {
    const c = await this.minha(ctx, id);
    const slug = await this.slug(ctx.tenantId);
    const r = await this.criarCarrinho(ctx.tenantId, slug, itens, c.id);
    const texto = `Separei seu carrinho 🛒\n${r.itens.join('\n')}\n\nTotal: ${r.total}${r.totalMembro !== r.total ? ` (membro: ${r.totalMembro})` : ''}\nÉ só abrir e finalizar: ${r.link}`;
    await this.enviar(ctx, id, texto);
    return r;
  }

  async enviarProduto(ctx: RequestContext, id: string, productId: string) {
    const slug = await this.slug(ctx.tenantId);
    const p = (await this.shop.catalog(slug)).products.find((x) => x.id === productId);
    if (!p) throw new BadRequestException('Produto fora do app ou inativo.');
    const texto = `*${p.name}*${p.brand ? ` · ${p.brand}` : ''}\n${formatMoney(p.price)}${p.memberPrice < p.price ? ` · membro ${formatMoney(p.memberPrice)}` : ''}${p.offer ? `\nOferta: ${formatMoney(p.offer.price)}${p.offer.membersOnly ? ' (membros)' : ''}` : ''}\n${publicUrl()}${productPath(p)}`;
    await this.enviar(ctx, id, texto);
    return { ok: true };
  }

  async slug(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (!t?.slug) throw new BadRequestException('A loja não tem endereço público (slug).');
    return t.slug;
  }

  /** Para o agente de IA (fora de requisição). */
  conversa(id: string) {
    return this.prisma.waConversation.findUnique({ where: { id } });
  }
}
