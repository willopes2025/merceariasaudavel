import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { IaService } from '../ai/ai.service';
import { AssistantService, VOZES_ELEVENLABS, VOZES_OPENAI, type ConfigAssistente } from './assistant.service';
import { FerramentasAssistente } from './tools';
import { can } from './user';

const uuid = new ParseUUIDPipe();
const EXTENSOES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a' };

const configSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao assistente').max(40),
  instrucoes: z.string().max(6000).default(''),
  voz: z.enum(['automatica', 'elevenlabs', 'openai', 'navegador']).default('automatica'),
  aprovacaoAutomatica: z.enum(['gestao', 'todos', 'ninguem']).default('gestao'),
  vozElevenlabs: z.string().trim().regex(/^[A-Za-z0-9]{10,40}$/, 'Id de voz da ElevenLabs inválido').default(VOZES_ELEVENLABS[0]!.id),
  vozOpenai: z.enum(VOZES_OPENAI.map((v) => v.id) as [string, ...string[]]).default('ash'),
});
const mensagemSchema = z.object({ texto: z.string().trim().max(8000).default(''), origem: z.enum(['texto', 'voz']).default('texto'), anexos: z.array(z.string().uuid()).max(10).default([]) });
const anexoSchema = z.object({ nome: z.string().trim().min(1).max(200), mime: z.string().max(120).default(''), conteudo: z.string().min(4, 'Arquivo vazio').max(25_000_000, 'Arquivo grande demais (máximo de 18 MB)') });
const transcreverSchema = z.object({ audio: z.string().min(100, 'Áudio vazio').max(20_000_000, 'Áudio longo demais (máximo de ~10 minutos)'), mime: z.string().max(80) });
const falarSchema = z.object({ texto: z.string().trim().min(1).max(6000), provedor: z.enum(['elevenlabs', 'openai']).optional(), voz: z.string().trim().max(40).optional() });
const aprovacaoSchema = z.object({ aprovacao: z.enum(['perguntar', 'automatico']) });
const rotinaSchema = z.object({ ativa: z.boolean().optional(), aprovacao: z.enum(['perguntar', 'automatico']).optional() });
const pedidoSchema = z.object({ status: z.enum(['novo', 'em_analise', 'em_andamento', 'pronto', 'recusado']) });

/** Assistente da equipe: conversa por texto ou voz, ações com confirmação, rotinas agendadas e pedidos. */
@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly assistente: AssistantService,
    private readonly ferramentas: FerramentasAssistente,
    private readonly ia: IaService,
  ) {}

  /** Estado para a tela: IA ligada, voz ligada, nome e o que esta pessoa consegue pedir. */
  @Get('state')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async estado(@Ctx() ctx: RequestContext) {
    const u = await this.assistente.usuario(ctx);
    const cfg = await this.assistente.config(ctx.tenantId);
    return {
      ligado: this.ia.texto,
      voz: this.ia.imagem,
      nome: cfg.nome,
      vozResposta: await this.assistente.provedorVoz(cfg),
      ferramentas: this.ferramentas.lista.filter((f) => f.permitido(u)).map((f) => ({ nome: f.nome, risco: f.risco })),
      podeConfigurar: can(u, PERMISSIONS.settingsManage),
      podeAutomatico: this.assistente.podeAutomatico(u, cfg),
    };
  }

  @Get('config')
  @RequiresPermission(PERMISSIONS.settingsManage)
  async config(@Ctx() ctx: RequestContext) {
    return { ...(await this.assistente.config(ctx.tenantId)), opcoes: { elevenlabs: VOZES_ELEVENLABS, openai: VOZES_OPENAI }, chaves: { elevenlabs: this.ia.temElevenlabs, openai: this.ia.imagem } };
  }

  @Put('config')
  @RequiresPermission(PERMISSIONS.settingsManage)
  salvarConfig(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(configSchema)) body: ConfigAssistente) {
    return this.assistente.salvarConfig(ctx.tenantId, body);
  }

  @Get('sessions')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async sessoes(@Ctx() ctx: RequestContext) {
    return this.assistente.sessoes(await this.assistente.usuario(ctx));
  }

  @Post('sessions')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async criar(@Ctx() ctx: RequestContext) {
    return this.assistente.criarSessao(await this.assistente.usuario(ctx));
  }

  @Get('sessions/:id')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async sessao(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.sessao(await this.assistente.usuario(ctx), id);
  }

  /** "Pedir aprovação" ou "Aprovar automaticamente" nesta conversa. */
  @Patch('sessions/:id')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async mudarSessao(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(aprovacaoSchema)) body: z.infer<typeof aprovacaoSchema>) {
    return this.assistente.mudarAprovacao(await this.assistente.usuario(ctx), id, body.aprovacao);
  }

  @Delete('sessions/:id')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async excluir(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.excluirSessao(await this.assistente.usuario(ctx), id);
  }

  @Post('sessions/:id/messages')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async enviar(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(mensagemSchema)) d: z.infer<typeof mensagemSchema>) {
    if (!d.texto && !d.anexos.length) throw new BadRequestException('Escreva, fale ou anexe o que precisa.');
    return this.assistente.enviar(await this.assistente.usuario(ctx), id, d.texto, d.origem, d.anexos);
  }

  /** Anexo da conversa em base64. Devolve o id para mandar junto com a mensagem. */
  @Post('attachments')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async anexar(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(anexoSchema)) d: z.infer<typeof anexoSchema>) {
    return this.assistente.anexar(await this.assistente.usuario(ctx), { nome: d.nome, mime: d.mime, conteudo: Buffer.from(d.conteudo, 'base64') });
  }

  @Get('attachments/:id')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async baixarAnexo(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const a = await this.assistente.anexo(await this.assistente.usuario(ctx), id);
    res.setHeader('content-type', a.mime);
    res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(Buffer.from(a.data));
  }

  /** Áudio gravado no microfone da tela: devolve o texto (a tela mostra e envia). */
  @Post('transcribe')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async transcrever(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(transcreverSchema)) d: z.infer<typeof transcreverSchema>) {
    const extensao = EXTENSOES[d.mime.split(';')[0]!.trim().toLowerCase()];
    if (!extensao) throw new BadRequestException(`Formato de áudio não aceito (${d.mime}).`);
    return { texto: await this.assistente.transcrever(await this.assistente.usuario(ctx), Buffer.from(d.audio, 'base64'), extensao) };
  }

  /** Resposta falada (MP3), na voz configurada. Com "provedor" e "voz", toca um exemplo antes de salvar. */
  @Post('speak')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async falar(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(falarSchema)) d: z.infer<typeof falarSchema>, @Res() res: Response) {
    const audio = await this.assistente.falar(await this.assistente.usuario(ctx), d.texto, d.provedor && d.voz ? { provedor: d.provedor, voz: d.voz } : undefined);
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('cache-control', 'private, max-age=600');
    res.send(audio);
  }

  @Post('actions/:id/confirm')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async confirmar(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.confirmar(await this.assistente.usuario(ctx), id);
  }

  @Post('actions/:id/cancel')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async cancelar(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.cancelar(await this.assistente.usuario(ctx), id);
  }

  // ───── Rotinas agendadas (agentes) ─────

  @Get('routines')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async rotinas(@Ctx() ctx: RequestContext) {
    return this.assistente.rotinas(await this.assistente.usuario(ctx));
  }

  @Patch('routines/:id')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async mudarRotina(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(rotinaSchema)) d: z.infer<typeof rotinaSchema>) {
    return this.assistente.mudarRotina(await this.assistente.usuario(ctx), id, d);
  }

  @Delete('routines/:id')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async excluirRotina(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.excluirRotina(await this.assistente.usuario(ctx), id);
  }

  @Post('routines/:id/duplicate')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async duplicarRotina(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.duplicarRotina(await this.assistente.usuario(ctx), id);
  }

  @Post('routines/:id/run')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async rodarAgora(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.assistente.rodarAgora(await this.assistente.usuario(ctx), id);
  }

  /** Pedidos de configuração e desenvolvimento (a gestão vê todos; os demais, os seus). */
  @Get('requests')
  @RequiresPermission(PERMISSIONS.assistantUse)
  async pedidos(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.assistente.pedidos(await this.assistente.usuario(ctx), status);
  }

  @Patch('requests/:id')
  @RequiresPermission(PERMISSIONS.settingsManage)
  async mudarPedido(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(pedidoSchema)) d: z.infer<typeof pedidoSchema>) {
    return this.assistente.mudarPedido(await this.assistente.usuario(ctx), id, d.status);
  }
}
