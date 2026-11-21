import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  PERMISSIONS,
  courierSchema,
  deliverySettingsSchema,
  deliveryZoneSchema,
  type CourierInput,
  type DeliverySettingsInput,
  type DeliveryZoneInput,
} from '@mercearia/contracts';
import { Ctx, Public, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { OrdersService } from '../orders/orders.service';
import { DeliveryService } from './delivery.service';

const uuid = new ParseUUIDPipe();

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('settings')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  settings(@Ctx() ctx: RequestContext) {
    return this.delivery.settings(ctx);
  }

  @Put('settings')
  @RequiresPermission(PERMISSIONS.settingsManage)
  saveSettings(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(deliverySettingsSchema)) body: DeliverySettingsInput) {
    return this.delivery.saveSettings(ctx, body);
  }

  @Get('zones')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  zones(@Ctx() ctx: RequestContext) {
    return this.delivery.zones(ctx);
  }

  @Post('zones')
  @RequiresPermission(PERMISSIONS.settingsManage)
  createZone(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(deliveryZoneSchema)) body: DeliveryZoneInput) {
    return this.delivery.saveZone(ctx, null, body);
  }

  @Put('zones/:id')
  @RequiresPermission(PERMISSIONS.settingsManage)
  updateZone(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(deliveryZoneSchema)) body: DeliveryZoneInput) {
    return this.delivery.saveZone(ctx, id, body);
  }

  @Get('couriers')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  couriers(@Ctx() ctx: RequestContext) {
    return this.delivery.couriers(ctx);
  }

  @Post('couriers')
  @RequiresPermission(PERMISSIONS.settingsManage)
  createCourier(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(courierSchema)) body: CourierInput) {
    return this.delivery.saveCourier(ctx, null, body);
  }

  @Put('couriers/:id')
  @RequiresPermission(PERMISSIONS.settingsManage)
  updateCourier(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(courierSchema)) body: CourierInput) {
    return this.delivery.saveCourier(ctx, id, body);
  }

  @Post('couriers/:id/rotate')
  @RequiresPermission(PERMISSIONS.settingsManage)
  rotate(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.delivery.rotateCourier(ctx, id);
  }
}

/** Página do entregador: aberta pelo link (o token é a senha). */
@Public()
@Controller('courier/:token')
export class CourierController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  run(@Param('token') token: string) {
    return this.orders.courierRun(token);
  }

  @Post('orders/:id/delivered')
  delivered(@Param('token') token: string, @Param('id', uuid) id: string) {
    return this.orders.courierDelivered(token, id);
  }
}
