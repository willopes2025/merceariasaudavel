import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS, dispatchSchema, orderAdvanceSchema, orderCancelSchema, type DispatchInput, type OrderAdvanceInput, type OrderCancelInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { OrdersService } from './orders.service';

const uuid = new ParseUUIDPipe();

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Tela de preparo. */
  @Get('board')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  board(@Ctx() ctx: RequestContext, @Query('storeId', uuid) storeId: string) {
    return this.orders.board(ctx, storeId);
  }

  /** Caixa: pedidos do app/totem para cobrar. */
  @Get('pending')
  @RequiresPermission(PERMISSIONS.saleCreate)
  pending(@Ctx() ctx: RequestContext, @Query('storeId', uuid) storeId: string) {
    return this.orders.pending(ctx, storeId);
  }

  /** Tela de entregas. */
  @Get('deliveries')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  deliveries(@Ctx() ctx: RequestContext, @Query('storeId', uuid) storeId: string) {
    return this.orders.deliveries(ctx, storeId);
  }

  @Post(':id/dispatch')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  dispatch(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(dispatchSchema)) body: DispatchInput) {
    return this.orders.dispatch(ctx, id, body.courierId);
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.saleCreate)
  get(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.orders.get(ctx, id);
  }

  @Post(':id/advance')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  advance(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(orderAdvanceSchema)) body: OrderAdvanceInput) {
    return this.orders.advance(ctx, id, body);
  }

  @Post(':id/cancel')
  @RequiresPermission(PERMISSIONS.saleCreate)
  cancel(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(orderCancelSchema)) body: OrderCancelInput) {
    return this.orders.cancel(ctx, id, body.reason);
  }
}
