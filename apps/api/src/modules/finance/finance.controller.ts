import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  cashflowQuery,
  dreQuery,
  financeConfigSchema,
  paymentFeesSchema,
  receivableManualSchema,
  receivableQuery,
  receivableSettleSchema,
  type CashflowQuery,
  type DreQuery,
  type FinanceConfig,
  type PaymentFeesInput,
  type ReceivableManualInput,
  type ReceivableQuery,
  type ReceivableSettleInput,
  PERMISSIONS, payableListQuery, payablePaySchema, payableSchema, reportQuery, type PayableInput, type PayableListQuery, type ReportQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { DreService } from './dre.service';
import { FinanceService } from './finance.service';
import { ReceivablesService } from './receivables.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly receivables: ReceivablesService,
    private readonly dreService: DreService,
  ) {}

  // ───────────── Contas a receber ─────────────

  @Get('receivables/summary')
  @RequiresPermission(PERMISSIONS.financeView)
  receivablesSummary(@Ctx() ctx: RequestContext) {
    return this.receivables.summary(ctx);
  }

  @Get('receivables')
  @RequiresPermission(PERMISSIONS.financeView)
  listReceivables(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(receivableQuery)) q: ReceivableQuery) {
    return this.receivables.list(ctx, q);
  }

  @Post('receivables')
  @RequiresPermission(PERMISSIONS.financeManage)
  createReceivable(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(receivableManualSchema)) d: ReceivableManualInput) {
    return this.receivables.createManual(ctx, d);
  }

  @Post('receivables/settle')
  @RequiresPermission(PERMISSIONS.financeManage)
  settleReceivables(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(receivableSettleSchema)) d: ReceivableSettleInput) {
    return this.receivables.settle(ctx, d);
  }

  @Post('receivables/:id/reopen')
  @RequiresPermission(PERMISSIONS.financeManage)
  reopenReceivable(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.receivables.reopen(ctx, id);
  }

  @Post('receivables/:id/cancel')
  @RequiresPermission(PERMISSIONS.financeManage)
  cancelReceivable(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.receivables.cancelManual(ctx, id);
  }

  @Get('payment-fees')
  @RequiresPermission(PERMISSIONS.financeView)
  fees(@Ctx() ctx: RequestContext) {
    return this.receivables.fees(ctx);
  }

  @Put('payment-fees')
  @RequiresPermission(PERMISSIONS.financeManage)
  saveFees(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(paymentFeesSchema)) d: PaymentFeesInput) {
    return this.receivables.saveFees(ctx, d);
  }

  @Get('finance/config')
  @RequiresPermission(PERMISSIONS.financeView)
  config(@Ctx() ctx: RequestContext) {
    return this.receivables.config(ctx.tenantId);
  }

  @Put('finance/config')
  @RequiresPermission(PERMISSIONS.financeManage)
  saveConfig(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(financeConfigSchema)) d: FinanceConfig) {
    return this.receivables.saveConfig(ctx, d);
  }

  // ───────────── DRE e fluxo de caixa ─────────────

  @Get('reports/dre')
  @RequiresPermission(PERMISSIONS.financeView)
  dre(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(dreQuery)) q: DreQuery) {
    return this.dreService.dre(ctx, q);
  }

  @Get('reports/cashflow')
  @RequiresPermission(PERMISSIONS.financeView)
  cashflow(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(cashflowQuery)) q: CashflowQuery) {
    return this.dreService.cashflow(ctx, q);
  }

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
