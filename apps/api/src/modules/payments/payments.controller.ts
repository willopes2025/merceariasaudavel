import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSIONS, onlinePayStartSchema, onlineSettingsSchema, type OnlinePayStartInput, type OnlineSettingsInput } from '@mercearia/contracts';
import { Ctx, Public, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentCustomer, CustomerAuthGuard, type CustomerSession } from '../shop/customer-auth';
import { ShopService } from '../shop/shop.service';
import { PaymentsService } from './payments.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments/settings')
  @RequiresPermission(PERMISSIONS.settingsManage)
  settings(@Ctx() ctx: RequestContext) {
    return this.payments.settings(ctx);
  }

  @Put('payments/settings')
  @RequiresPermission(PERMISSIONS.settingsManage)
  save(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(onlineSettingsSchema)) body: OnlineSettingsInput) {
    return this.payments.saveSettings(ctx, body);
  }

  /** Caixa: registra a venda de um pedido já pago pelo app. */
  @Post('orders/:id/settle-online')
  @RequiresPermission(PERMISSIONS.saleCreate)
  settle(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.payments.settleForStaff(ctx, id);
  }

  /** Provedor de teste: simula a cliente pagando. */
  @Post('payments/test/orders/:id/approve')
  @RequiresPermission(PERMISSIONS.settingsManage)
  testApprove(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body() body: { amount?: number } = {}) {
    return this.payments.testApprove(ctx, id, typeof body?.amount === 'number' ? body.amount : undefined);
  }
}

/** Aviso do Mercado Pago: responde 200 sempre (o status vem de uma consulta à API). */
@Public()
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('mercadopago')
  @HttpCode(200)
  async mercadopago(@Req() req: Request, @Query() query: Record<string, unknown>, @Body() body: unknown) {
    await this.payments.webhook({ headers: req.headers, query, body }).catch(() => undefined);
    return { ok: true };
  }
}

/** Pagar o pedido pelo app (cliente logada) ou no totem. */
@Public()
@Controller('shop/:slug')
export class ShopPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly shop: ShopService,
  ) {}

  @Post('me/orders/:id/pay')
  @UseGuards(CustomerAuthGuard)
  async pay(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(onlinePayStartSchema)) body: OnlinePayStartInput) {
    return this.payments.startForCustomer(await this.place(slug, s), s.customerId, id, body.method);
  }

  @Get('me/orders/:id/pay')
  @UseGuards(CustomerAuthGuard)
  async payment(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Param('id', uuid) id: string) {
    return (await this.payments.viewForCustomer(await this.place(slug, s), s.customerId, id)) ?? { status: null };
  }

  @Post('totem/orders/:id/pay')
  async payTotem(@Param('slug') slug: string, @Param('id', uuid) id: string) {
    const t = await this.shop.tenant(slug);
    return this.payments.startForTotem({ tenantId: t.tenantId, storeId: t.storeId }, id);
  }

  @Get('totem/orders/:id/pay')
  async paymentTotem(@Param('slug') slug: string, @Param('id', uuid) id: string) {
    const t = await this.shop.tenant(slug);
    return (await this.payments.viewForTotem({ tenantId: t.tenantId, storeId: t.storeId }, id)) ?? { status: null };
  }

  private async place(slug: string, s: CustomerSession) {
    const t = await this.shop.tenant(slug);
    if (t.tenantId !== s.tenantId) throw new UnauthorizedException('Sessão de outra loja: entre de novo');
    return { tenantId: t.tenantId, storeId: t.storeId };
  }
}
