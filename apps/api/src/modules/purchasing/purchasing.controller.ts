import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  PERMISSIONS,
  purchaseOrderSchema,
  purchaseStatusSchema,
  stockIntelQuery,
  supplierSchema,
  type PurchaseOrderInput,
  type StockIntelQuery,
  type SupplierInput,
} from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PurchasingService } from './purchasing.service';

const uuid = new ParseUUIDPipe();
const statusBody = purchaseStatusSchema.extend({ addStock: z.boolean().default(false) });

@Controller()
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get('suppliers')
  @RequiresPermission(PERMISSIONS.stockView)
  suppliers(@Ctx() ctx: RequestContext) {
    return this.purchasing.suppliers(ctx);
  }

  @Post('suppliers')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  createSupplier(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput) {
    return this.purchasing.saveSupplier(ctx, null, body);
  }

  @Put('suppliers/:id')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  updateSupplier(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput) {
    return this.purchasing.saveSupplier(ctx, id, body);
  }

  /** Curva ABC, cobertura, giro, ruptura, parado, risco de vencer e compra sugerida. */
  @Get('stock/intelligence')
  @RequiresPermission(PERMISSIONS.stockView)
  intelligence(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(stockIntelQuery)) q: StockIntelQuery) {
    return this.purchasing.intelligence(ctx, q);
  }

  @Get('purchase-orders')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  orders(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.purchasing.orders(ctx, status);
  }

  @Get('purchase-orders/:id')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  order(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.purchasing.order(ctx, id);
  }

  @Post('purchase-orders')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(purchaseOrderSchema)) body: PurchaseOrderInput) {
    return this.purchasing.saveOrder(ctx, null, body);
  }

  @Put('purchase-orders/:id')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  update(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(purchaseOrderSchema)) body: PurchaseOrderInput) {
    return this.purchasing.saveOrder(ctx, id, body);
  }

  @Post('purchase-orders/:id/status')
  @RequiresPermission(PERMISSIONS.purchaseManage)
  status(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(statusBody)) body: z.infer<typeof statusBody>) {
    return this.purchasing.setStatus(ctx, id, body);
  }
}
