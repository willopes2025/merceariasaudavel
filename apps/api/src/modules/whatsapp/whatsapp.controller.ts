import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@mercearia/contracts';
import { Ctx, Public, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { WhatsappSender } from '../notify/whatsapp.sender';
import { metaSignatureOk } from '../notify/whatsapp.provider';
import { waConfigSchema } from './whatsapp.config';
import { WhatsappService, type Filtro } from './whatsapp.service';

const uuid = new ParseUUIDPipe();
const textoSchema = z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem').max(4000) });
const modeloSchema = z.object({ nome: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Nome do modelo: letras minúsculas, números e _'), idioma: z.string().trim().max(10).default('pt_BR'), parametros: z.array(z.string().max(1000)).max(10).default([]) });
const mudarSchema = z.object({ status: z.enum(['aberta', 'resolvida']).optional(), aiEnabled: z.boolean().optional(), assumir: z.boolean().optional(), customerId: z.string().uuid().nullable().optional() });
const iniciarSchema = z.object({ customerId: z.string().uuid().optional(), phone: z.string().max(30).optional() }).refine((d) => d.customerId || d.phone, 'Diga a cliente ou o celular');
const carrinhoSchema = z.object({ itens: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(50) })).min(1).max(30) });
const produtoSchema = z.object({ productId: z.string().uuid() });
const FILTROS = ['abertas', 'minhas', 'equipe', 'ia', 'resolvidas', 'todas'];

const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Atendimento no WhatsApp (equipe). */
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly wa: WhatsappService) {}

  @Get('status')
  @RequiresPermission(PERMISSIONS.customerView)
  async status(@Ctx() ctx: RequestContext) {
    const canal = this.wa.canal;
    const cfg = await this.wa.config(ctx.tenantId);
    const gestao = ctx.permissions.includes('*') || ctx.permissions.includes(PERMISSIONS.settingsManage);
    let entrada: string | null = null;
    if (gestao && canal.provedor) {
      const base = `${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}/v1/whatsapp`;
      const slug = await this.wa.slug(ctx.tenantId).catch(() => 'sua-loja');
      entrada = canal.provedor === 'meta' ? `${base}/meta/${slug}` : process.env.WHATSAPP_INBOUND_SECRET ? `${base}/in/${slug}/${process.env.WHATSAPP_INBOUND_SECRET}` : null;
    }
    return { ...canal, slug: await this.wa.slug(ctx.tenantId).catch(() => null), ia: { ligado: cfg.ligado, nome: cfg.nome }, entrada, faltaSegredo: canal.provedor !== null && canal.provedor !== 'meta' && !process.env.WHATSAPP_INBOUND_SECRET };
  }

  @Get('config')
  @RequiresPermission(PERMISSIONS.settingsManage)
  config(@Ctx() ctx: RequestContext) {
    return this.wa.config(ctx.tenantId);
  }

  @Put('config')
  @RequiresPermission(PERMISSIONS.settingsManage)
  salvar(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(waConfigSchema)) body: unknown) {
    return this.wa.salvarConfig(ctx.tenantId, body);
  }

  @Get('conversations')
  @RequiresPermission(PERMISSIONS.customerView)
  listar(@Ctx() ctx: RequestContext, @Query('filtro') filtro?: string, @Query('busca') busca?: string) {
    return this.wa.listar(ctx, (FILTROS.includes(filtro ?? '') ? filtro : 'abertas') as Filtro, busca?.slice(0, 60));
  }

  @Post('conversations')
  @RequiresPermission(PERMISSIONS.customerManage)
  iniciar(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(iniciarSchema)) d: z.infer<typeof iniciarSchema>) {
    return this.wa.iniciar(ctx, d);
  }

  @Get('conversations/:id')
  @RequiresPermission(PERMISSIONS.customerView)
  abrir(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.wa.abrir(ctx, id);
  }

  @Patch('conversations/:id')
  @RequiresPermission(PERMISSIONS.customerManage)
  mudar(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(mudarSchema)) d: z.infer<typeof mudarSchema>) {
    return this.wa.mudar(ctx, id, d);
  }

  @Post('conversations/:id/messages')
  @RequiresPermission(PERMISSIONS.customerManage)
  enviar(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(textoSchema)) d: z.infer<typeof textoSchema>) {
    return this.wa.enviar(ctx, id, d.texto);
  }

  @Post('conversations/:id/template')
  @RequiresPermission(PERMISSIONS.customerManage)
  modelo(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(modeloSchema)) d: z.infer<typeof modeloSchema>) {
    return this.wa.enviarModelo(ctx, id, d);
  }

  @Post('conversations/:id/product')
  @RequiresPermission(PERMISSIONS.customerManage)
  produto(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(produtoSchema)) d: z.infer<typeof produtoSchema>) {
    return this.wa.enviarProduto(ctx, id, d.productId);
  }

  @Post('conversations/:id/cart')
  @RequiresPermission(PERMISSIONS.customerManage)
  carrinho(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(carrinhoSchema)) d: z.infer<typeof carrinhoSchema>) {
    return this.wa.enviarCarrinho(ctx, id, d.itens);
  }
}

/** Webhooks dos provedores (sem login) e o carrinho do link (loja online). */
@Public()
@Controller()
export class WhatsappWebhookController {
  constructor(
    private readonly wa: WhatsappService,
    private readonly sender: WhatsappSender,
  ) {}

  /** Z-API, webhook genérico e teste: a URL leva um segredo (WHATSAPP_INBOUND_SECRET). */
  @Post('whatsapp/in/:slug/:secret')
  @HttpCode(200)
  async entrada(@Param('slug') slug: string, @Param('secret') secret: string, @Body() body: unknown) {
    const esperado = process.env.WHATSAPP_INBOUND_SECRET?.trim();
    if (!esperado) throw new ServiceUnavailableException('Entrada de WhatsApp não configurada (WHATSAPP_INBOUND_SECRET).');
    if (!igual(secret, esperado)) throw new ForbiddenException();
    const p = this.sender.provider;
    if (!p || p.kind === 'meta') throw new ServiceUnavailableException('Provedor de WhatsApp sem entrada por esta URL.');
    return this.wa.receber(slug, p.parse(body));
  }

  /** API oficial: verificação do webhook pela Meta. */
  @Get('whatsapp/meta/:slug')
  verificar(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const esperado = process.env.META_WA_VERIFY_TOKEN?.trim();
    if (mode !== 'subscribe' || !esperado || !token || !igual(token, esperado)) throw new ForbiddenException();
    res.type('text/plain').send(String(challenge ?? ''));
  }

  @Post('whatsapp/meta/:slug')
  @HttpCode(200)
  async meta(@Param('slug') slug: string, @Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') assinatura: string | undefined, @Body() body: unknown) {
    const p = this.sender.provider;
    const segredo = process.env.META_WA_APP_SECRET?.trim();
    if (!p || p.kind !== 'meta' || !segredo) throw new ServiceUnavailableException('API oficial do WhatsApp não configurada.');
    if (!metaSignatureOk(segredo, req.rawBody, assinatura)) throw new ForbiddenException();
    return this.wa.receber(slug, p.parse(body));
  }

  @Get('shop/:slug/wa-carts/:id')
  carrinho(@Param('slug') slug: string, @Param('id') id: string) {
    if (!/^[\w-]{8,20}$/.test(id)) throw new BadRequestException('Link inválido.');
    return this.wa.carrinho(slug, id);
  }
}
