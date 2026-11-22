import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, bankLineActionSchema, budgetSaveSchema, ofxImportSchema, reportQuery, statementQuery, todayBR, type BankLineAction, type BudgetSaveInput, type ReportQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ControlService } from './control.service';

const uuid = new ParseUUIDPipe();
const mes = (m?: string) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : todayBR().slice(0, 7));

/** Conciliação bancária, orçamento e comissão de vendedor. */
@Controller()
export class ControlController {
  constructor(private readonly control: ControlService) {}

  @Post('financial-accounts/:id/ofx')
  @RequiresPermission(PERMISSIONS.financeManage)
  ofx(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(ofxImportSchema)) d: { content: string }) {
    return this.control.importOfx(ctx, id, d.content);
  }

  @Get('financial-accounts/:id/reconciliation')
  @RequiresPermission(PERMISSIONS.financeView)
  reconciliation(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Query(new ZodValidationPipe(statementQuery)) q: { from: string; to: string }) {
    return this.control.reconciliation(ctx, id, q.from, q.to);
  }

  @Post('bank-lines/:id')
  @RequiresPermission(PERMISSIONS.financeManage)
  bankLine(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(bankLineActionSchema)) a: BankLineAction) {
    return this.control.bankLineAction(ctx, id, a);
  }

  @Get('budget')
  @RequiresPermission(PERMISSIONS.financeView)
  budget(@Ctx() ctx: RequestContext, @Query('month') month?: string) {
    return this.control.budget(ctx, mes(month));
  }

  @Put('budget')
  @RequiresPermission(PERMISSIONS.financeManage)
  saveBudget(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(budgetSaveSchema)) d: BudgetSaveInput) {
    return this.control.saveBudget(ctx, d);
  }

  @Get('reports/seller-commission')
  @RequiresPermission(PERMISSIONS.financeView)
  commission(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(reportQuery)) q: ReportQuery) {
    return this.control.sellerCommission(ctx, q.from, q.to);
  }
}
