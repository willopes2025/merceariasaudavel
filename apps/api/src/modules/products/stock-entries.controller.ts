import { Body, Controller, Get, Post } from '@nestjs/common';
import { PERMISSIONS, stockEntryPreviewSchema, stockEntrySchema, type StockEntryInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { StockEntriesService } from './stock-entries.service';

@Controller('stock-entries')
export class StockEntriesController {
  constructor(private readonly entries: StockEntriesService) {}

  @Get()
  @RequiresPermission(PERMISSIONS.stockView)
  list(@Ctx() ctx: RequestContext) {
    return this.entries.list(ctx);
  }

  /** Lê o XML e mostra o que vai entrar. Não grava nada. */
  @Post('preview')
  @RequiresPermission(PERMISSIONS.stockAdjust)
  preview(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(stockEntryPreviewSchema)) body: { xml: string }) {
    return this.entries.preview(ctx, body.xml);
  }

  @Post()
  @RequiresPermission(PERMISSIONS.stockAdjust)
  confirm(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(stockEntrySchema)) body: StockEntryInput) {
    return this.entries.confirm(ctx, body);
  }
}
