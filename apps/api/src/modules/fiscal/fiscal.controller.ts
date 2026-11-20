import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, fiscalCancelSchema, fiscalConfigSchema, fiscalEmitSchema, fiscalListQuery, type FiscalConfigInput, type FiscalEmitInput, type FiscalListQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { FiscalService } from './fiscal.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get('fiscal/config')
  @RequiresPermission(PERMISSIONS.settingsManage)
  configs(@Ctx() ctx: RequestContext) {
    return this.fiscal.configs(ctx);
  }

  @Put('fiscal/config/:storeId')
  @RequiresPermission(PERMISSIONS.settingsManage)
  save(@Ctx() ctx: RequestContext, @Param('storeId', uuid) storeId: string, @Body(new ZodValidationPipe(fiscalConfigSchema)) body: FiscalConfigInput) {
    return this.fiscal.saveConfig(ctx, storeId, body);
  }

  @Post('fiscal/config/:storeId/test')
  @RequiresPermission(PERMISSIONS.settingsManage)
  test(@Ctx() ctx: RequestContext, @Param('storeId', uuid) storeId: string) {
    return this.fiscal.testConfig(ctx, storeId);
  }

  @Get('fiscal/documents')
  @RequiresPermission(PERMISSIONS.fiscalView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(fiscalListQuery)) q: FiscalListQuery) {
    return this.fiscal.list(ctx, q);
  }

  @Post('fiscal/documents/:id/refresh')
  @RequiresPermission(PERMISSIONS.fiscalEmit)
  refresh(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.fiscal.refresh(ctx, id);
  }

  @Post('fiscal/documents/:id/cancel')
  @RequiresPermission(PERMISSIONS.fiscalCancel)
  cancel(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(fiscalCancelSchema)) body: { reason: string }) {
    return this.fiscal.cancel(ctx, id, body.reason);
  }

  /** O que iria na nota desta venda e as notas que ela já tem. */
  @Get('sales/:id/fiscal')
  @RequiresPermission(PERMISSIONS.fiscalView)
  preview(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.fiscal.preview(ctx, id);
  }

  @Post('sales/:id/fiscal/nfce')
  @RequiresPermission(PERMISSIONS.fiscalEmit)
  emit(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(fiscalEmitSchema)) body: FiscalEmitInput) {
    return this.fiscal.emit(ctx, id, body);
  }
}
