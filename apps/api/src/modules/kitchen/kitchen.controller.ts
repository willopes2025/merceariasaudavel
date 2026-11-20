import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS, inventoryCountSchema, lossReportQuery, type InventoryCountInput, type LossReportQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { KitchenService } from './kitchen.service';

const uuid = new ParseUUIDPipe();

@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('count-sheet')
  @RequiresPermission(PERMISSIONS.stockLoss)
  sheet(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string, @Query('scope') scope?: string) {
    if (!storeId || !/^[0-9a-f-]{36}$/i.test(storeId)) throw new DomainError('STORE_REQUIRED', 'Escolha a loja.');
    return this.kitchen.countSheet(ctx, storeId, scope === 'geral' ? 'geral' : 'insumos');
  }

  @Get('counts')
  @RequiresPermission(PERMISSIONS.stockView)
  counts(@Ctx() ctx: RequestContext) {
    return this.kitchen.counts(ctx);
  }

  @Get('counts/:id')
  @RequiresPermission(PERMISSIONS.stockView)
  count(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.kitchen.getCount(ctx, id);
  }

  @Post('counts')
  @RequiresPermission(PERMISSIONS.stockLoss)
  saveCount(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(inventoryCountSchema)) body: InventoryCountInput) {
    return this.kitchen.saveCount(ctx, body);
  }

  @Get('losses')
  @RequiresPermission(PERMISSIONS.reportView)
  losses(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(lossReportQuery)) q: LossReportQuery) {
    return this.kitchen.lossReport(ctx, q);
  }
}
