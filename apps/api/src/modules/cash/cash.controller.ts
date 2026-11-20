import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  cashCloseSchema,
  cashManualSchema,
  cashOpenSchema,
  type CashCloseInput,
  type CashManualInput,
  type CashOpenInput,
} from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CashService } from './cash.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('payment-methods')
  @RequiresPermission(PERMISSIONS.cashOperate)
  methods(@Ctx() ctx: RequestContext) {
    return this.cash.methods(ctx);
  }

  @Get('cash/current')
  @RequiresPermission(PERMISSIONS.cashOperate)
  current(@Ctx() ctx: RequestContext, @Query('storeId', uuid) storeId: string) {
    return this.cash.current(ctx, storeId).then((session) => ({ session }));
  }

  @Get('cash/sessions')
  @RequiresPermission(PERMISSIONS.financeView)
  history(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string, @Query('page') page?: string) {
    return this.cash.history(ctx, storeId && /^[0-9a-f-]{36}$/i.test(storeId) ? storeId : undefined, Math.max(1, Number(page) || 1));
  }

  @Get('cash/sessions/:id')
  @RequiresPermission(PERMISSIONS.cashOperate)
  get(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.cash.get(ctx, id);
  }

  @Post('cash/open')
  @RequiresPermission(PERMISSIONS.cashOperate)
  open(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(cashOpenSchema)) body: CashOpenInput) {
    return this.cash.open(ctx, body);
  }

  @Post('cash/sessions/:id/movements')
  @RequiresPermission(PERMISSIONS.cashOperate)
  manual(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(cashManualSchema)) body: CashManualInput) {
    return this.cash.manual(ctx, id, body);
  }

  @Post('cash/sessions/:id/close')
  @RequiresPermission(PERMISSIONS.cashClose)
  close(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(cashCloseSchema)) body: CashCloseInput) {
    return this.cash.close(ctx, id, body);
  }
}
