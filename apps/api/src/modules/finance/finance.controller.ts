import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS, payableListQuery, payablePaySchema, payableSchema, reportQuery, type PayableInput, type PayableListQuery, type ReportQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { FinanceService } from './finance.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('payables')
  @RequiresPermission(PERMISSIONS.financeView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(payableListQuery)) q: PayableListQuery) {
    return this.finance.listPayables(ctx, q);
  }

  @Post('payables')
  @RequiresPermission(PERMISSIONS.financeManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(payableSchema)) body: PayableInput) {
    return this.finance.createPayable(ctx, body);
  }

  @Post('payables/:id/pay')
  @RequiresPermission(PERMISSIONS.financeManage)
  pay(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(payablePaySchema)) body: { paidDate: string; note?: string | null }) {
    return this.finance.payPayable(ctx, id, body.paidDate, body.note);
  }

  @Post('payables/:id/cancel')
  @RequiresPermission(PERMISSIONS.financeManage)
  cancel(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.finance.setPayable(ctx, id, 'canceled');
  }

  @Post('payables/:id/reopen')
  @RequiresPermission(PERMISSIONS.financeManage)
  reopen(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.finance.setPayable(ctx, id, 'open');
  }

  @Get('reports/period')
  @RequiresPermission(PERMISSIONS.reportView)
  report(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(reportQuery)) q: ReportQuery) {
    return this.finance.report(ctx, q);
  }
}
