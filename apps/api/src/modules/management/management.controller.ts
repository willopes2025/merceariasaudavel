import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, goalSchema, tvScreenSchema, type GoalInput, type TvScreenInput } from '@mercearia/contracts';
import { Ctx, Public, RequiresPermission } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AlertsService } from './alerts.service';
import { ManagementService } from './management.service';

const uuid = new ParseUUIDPipe();
const optionalUuid = (v?: string) => {
  if (!v) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new DomainError('BAD_ID', 'Referência inválida.');
  return v;
};

@Controller()
export class ManagementController {
  constructor(
    private readonly management: ManagementService,
    private readonly alertsService: AlertsService,
  ) {}

  /** Avisos do que pede atenção: cada pessoa vê só o que tem permissão. */
  @Get('alerts')
  alerts(@Ctx() ctx: RequestContext) {
    return this.alertsService.list(ctx);
  }

  @Get('dashboard')
  @RequiresPermission(PERMISSIONS.reportView)
  dashboard(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string) {
    return this.management.dashboard(ctx, optionalUuid(storeId));
  }

  @Get('goals')
  @RequiresPermission(PERMISSIONS.reportView)
  goals(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.management.goals(ctx, status !== 'all');
  }

  @Post('goals')
  @RequiresPermission(PERMISSIONS.goalManage)
  createGoal(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(goalSchema)) body: GoalInput) {
    return this.management.saveGoal(ctx, null, body);
  }

  @Put('goals/:id')
  @RequiresPermission(PERMISSIONS.goalManage)
  updateGoal(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(goalSchema)) body: GoalInput) {
    return this.management.saveGoal(ctx, id, body);
  }

  @Get('tv-screens')
  @RequiresPermission(PERMISSIONS.goalManage)
  tvScreens(@Ctx() ctx: RequestContext) {
    return this.management.tvScreens(ctx);
  }

  @Post('tv-screens')
  @RequiresPermission(PERMISSIONS.goalManage)
  createTv(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(tvScreenSchema)) body: TvScreenInput) {
    return this.management.saveTv(ctx, null, body);
  }

  @Put('tv-screens/:id')
  @RequiresPermission(PERMISSIONS.goalManage)
  updateTv(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(tvScreenSchema)) body: TvScreenInput) {
    return this.management.saveTv(ctx, id, body);
  }

  /** Troca o link: o antigo para de funcionar na hora. */
  @Post('tv-screens/:id/rotate')
  @RequiresPermission(PERMISSIONS.goalManage)
  rotateTv(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(tvScreenSchema)) body: TvScreenInput) {
    return this.management.saveTv(ctx, id, body, true);
  }

  /** A TV: pública, só com o token do link. */
  @Public()
  @Get('tv/:token')
  tv(@Param('token') token: string) {
    return this.management.tvData(String(token).slice(0, 80));
  }
}
