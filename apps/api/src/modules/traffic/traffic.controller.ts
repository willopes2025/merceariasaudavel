import { timingSafeEqual } from 'node:crypto';
import { All, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Put, Query, ServiceUnavailableException } from '@nestjs/common';
import { PERMISSIONS, reportQuery, trafficManualSchema, type ReportQuery, type TrafficManualInput } from '@mercearia/contracts';
import { Ctx, Public, RequiresPermission } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { TrafficService } from './traffic.service';

const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const inteiro = (v: unknown, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 500 ? Math.floor(n) : padrao;
};

@Controller('traffic')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @Get('report')
  @RequiresPermission(PERMISSIONS.reportView)
  report(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(reportQuery)) q: ReportQuery) {
    return this.traffic.report(ctx, q.from, q.to, q.storeId);
  }

  @Get('day')
  @RequiresPermission(PERMISSIONS.reportView)
  day(@Ctx() ctx: RequestContext, @Query('storeId', new ParseUUIDPipe()) storeId: string, @Query('day') day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) throw new DomainError('BAD_DAY', 'Dia inválido.');
    return this.traffic.day(ctx, storeId, day);
  }

  @Put('manual')
  @RequiresPermission(PERMISSIONS.goalManage)
  manual(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(trafficManualSchema)) d: TrafficManualInput) {
    return this.traffic.manual(ctx, d);
  }

  /**
   * Entrada da câmera, sem login: a URL leva um segredo (TRAFFIC_SECRET). Aceita GET ou POST, com os números na
   * URL (?in=1&out=0&store=CODIGO) ou no corpo ({"in":1,"out":0}). Sem número nenhum, conta uma entrada.
   */
  @Public()
  @All('in/:slug/:secret')
  @HttpCode(200)
  entrada(@Param('slug') slug: string, @Param('secret') secret: string, @Query() q: Record<string, string>, @Body() body: Record<string, unknown> | undefined) {
    const esperado = process.env.TRAFFIC_SECRET?.trim();
    if (!esperado) throw new ServiceUnavailableException('Contagem por câmera não configurada (TRAFFIC_SECRET).');
    if (!igual(secret, esperado)) throw new ForbiddenException();
    const b = body && typeof body === 'object' ? body : {};
    const entradas = q.in ?? q.entries ?? b.in ?? b.entries;
    const saidas = q.out ?? q.exits ?? b.out ?? b.exits;
    return this.traffic.fromCamera(slug, q.store || (typeof b.store === 'string' ? b.store : undefined), inteiro(entradas, saidas == null ? 1 : 0), inteiro(saidas, 0));
  }
}
