import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  accountMoveSchema,
  chartAccountSchema,
  dreEntriesQuery,
  financialAccountSchema,
  payableClassifySchema,
  statementQuery,
  type AccountMoveInput,
  type ChartAccountInput,
  type FinancialAccountInput,
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
import { LedgerService } from './ledger.service';
import { ReceivablesService } from './receivables.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly receivables: ReceivablesService,
    private readonly dreService: DreService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────── Plano de contas ─────────────

  @Get('chart-accounts')
  @RequiresPermission(PERMISSIONS.financeView)
  chart(@Ctx() ctx: RequestContext) {
    return this.ledger.chart(ctx);
  }

  @Post('chart-accounts')
  @RequiresPermission(PERMISSIONS.financeManage)
  createChart(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(chartAccountSchema)) d: ChartAccountInput) {
    return this.ledger.saveChartAccount(ctx, null, d);
  }

  @Put('chart-accounts/:id')
  @RequiresPermission(PERMISSIONS.financeManage)
  saveChart(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(chartAccountSchema)) d: ChartAccountInput) {
    return this.ledger.saveChartAccount(ctx, id, d);
  }

  @Delete('chart-accounts/:id')
  @RequiresPermission(PERMISSIONS.financeManage)
  deleteChart(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.ledger.deleteChartAccount(ctx, id);
  }

  // ───────────── Contas financeiras (caixa, banco) ─────────────

  @Get('financial-accounts')
  @RequiresPermission(PERMISSIONS.financeView)
  accounts(@Ctx() ctx: RequestContext) {
    return this.ledger.accounts(ctx);
  }

  @Post('financial-accounts')
  @RequiresPermission(PERMISSIONS.financeManage)
  createAccount(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(financialAccountSchema)) d: FinancialAccountInput) {
    return this.ledger.saveAccount(ctx, null, d);
  }

  @Put('financial-accounts/:id')
  @RequiresPermission(PERMISSIONS.financeManage)
  saveAccount(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(financialAccountSchema)) d: FinancialAccountInput) {
    return this.ledger.saveAccount(ctx, id, d);
  }

  @Get('financial-accounts/:id/statement')
  @RequiresPermission(PERMISSIONS.financeView)
  async statement(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Query(new ZodValidationPipe(statementQuery)) q: { from: string; to: string }) {
    await this.receivables.sync(ctx.tenantId);
    return this.ledger.statement(ctx, id, q.from, q.to);
  }

  @Post('account-moves')
  @RequiresPermission(PERMISSIONS.financeManage)
  move(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(accountMoveSchema)) d: AccountMoveInput) {
    return this.ledger.move(ctx, d);
  }

  @Delete('account-entries/:id')
  @RequiresPermission(PERMISSIONS.financeManage)
  deleteEntry(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.ledger.deleteEntry(ctx, id);
  }

  @Get('reports/dre/entries')
  @RequiresPermission(PERMISSIONS.financeView)
  dreEntries(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(dreEntriesQuery)) q: { accountId: string; from: string; to: string; view: 'competencia' | 'caixa' }) {
    return this.dreService.entries(ctx, q.accountId, q.from, q.to, q.view);
  }

  @Patch('payables/:id')
  @RequiresPermission(PERMISSIONS.financeManage)
  classify(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(payableClassifySchema)) d: { chartAccountId?: string | null; supplierId?: string | null; competence?: string | null; document?: string | null }) {
    return this.finance.classifyPayable(ctx, id, d);
  }

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
  pay(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(payablePaySchema)) body: { paidDate: string; note?: string | null; accountId?: string | null }) {
    return this.finance.payPayable(ctx, id, body.paidDate, body.note, body.accountId);
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
