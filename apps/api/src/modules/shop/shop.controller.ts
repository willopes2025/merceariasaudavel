import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  addressSchema,
  type AddressInput,
  shopOrderSchema,
  totemOrderSchema,
  type ShopOrderInput,
  type TotemOrderInput,
  shopLoginSchema,
  shopPinSchema,
  shopProfileSchema,
  shopSignupSchema,
  type ShopLoginInput,
  type ShopPinInput,
  type ShopProfileInput,
  type ShopSignupInput,
} from '@mercearia/contracts';
import { Public } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentCustomer, CustomerAuthGuard, type CustomerSession } from './customer-auth';
import { OrdersService } from '../orders/orders.service';
import { ShopService } from './shop.service';

const uuid = new ParseUUIDPipe();

/**
 * App do cliente e cardápio: /v1/shop/:slug/...
 * Vitrine e cadastro são abertos; "minha conta" pede o token do cliente.
 * O token da equipe não serve aqui (e o do cliente não serve nas rotas da equipe).
 */
@Public()
@Controller('shop/:slug')
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly orders: OrdersService,
  ) {}

  @Get()
  info(@Param('slug') slug: string) {
    return this.shop.info(slug);
  }

  @Get('catalog')
  catalog(@Param('slug') slug: string) {
    return this.shop.catalog(slug);
  }

  @Get('kits')
  kits(@Param('slug') slug: string) {
    return this.shop.kits(slug);
  }

  @Post('signup')
  signup(@Param('slug') slug: string, @Body(new ZodValidationPipe(shopSignupSchema)) body: ShopSignupInput, @Req() req: Request) {
    return this.shop.signup(slug, body, req.ip ?? 'desconhecido');
  }

  @Post('login')
  login(@Param('slug') slug: string, @Body(new ZodValidationPipe(shopLoginSchema)) body: ShopLoginInput) {
    return this.shop.login(slug, body);
  }

  @Get('me')
  @UseGuards(CustomerAuthGuard)
  me(@CurrentCustomer() s: CustomerSession) {
    return this.shop.me(s);
  }

  @Put('me')
  @UseGuards(CustomerAuthGuard)
  updateProfile(@CurrentCustomer() s: CustomerSession, @Body(new ZodValidationPipe(shopProfileSchema)) body: ShopProfileInput) {
    return this.shop.updateProfile(s, body);
  }

  @Post('me/pin')
  @UseGuards(CustomerAuthGuard)
  changePin(@CurrentCustomer() s: CustomerSession, @Body(new ZodValidationPipe(shopPinSchema)) body: ShopPinInput) {
    return this.shop.changePin(s, body);
  }

  @Get('me/cashback')
  @UseGuards(CustomerAuthGuard)
  cashback(@CurrentCustomer() s: CustomerSession) {
    return this.shop.cashback(s);
  }

  @Get('me/purchases')
  @UseGuards(CustomerAuthGuard)
  purchases(@CurrentCustomer() s: CustomerSession) {
    return this.shop.purchases(s);
  }

  /** "Hora de repor": produtos que a cliente costuma comprar e devem estar acabando. */
  @Get('me/repurchase')
  @UseGuards(CustomerAuthGuard)
  async repurchase(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession) {
    await this.place(slug, s);
    return this.shop.repurchase(slug, s);
  }

  @Get('me/addresses')
  @UseGuards(CustomerAuthGuard)
  async addresses(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession) {
    await this.place(slug, s);
    return this.shop.addresses(s);
  }

  @Post('me/addresses')
  @UseGuards(CustomerAuthGuard)
  async addAddress(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Body(new ZodValidationPipe(addressSchema)) body: AddressInput) {
    await this.place(slug, s);
    return this.shop.saveAddress(s, null, body);
  }

  @Put('me/addresses/:id')
  @UseGuards(CustomerAuthGuard)
  async updateAddress(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(addressSchema)) body: AddressInput) {
    await this.place(slug, s);
    return this.shop.saveAddress(s, id, body);
  }

  @Delete('me/addresses/:id')
  @UseGuards(CustomerAuthGuard)
  async deleteAddress(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Param('id', uuid) id: string) {
    await this.place(slug, s);
    return this.shop.deleteAddress(s, id);
  }

  // ------------------------------------------------------------ pedidos

  /** Pedido da cliente logada: paga no caixa e vai para o preparo. */
  @Post('me/orders')
  @UseGuards(CustomerAuthGuard)
  async order(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Body(new ZodValidationPipe(shopOrderSchema)) body: ShopOrderInput) {
    return this.orders.createFromApp(await this.place(slug, s), s.customerId, body);
  }

  @Get('me/orders')
  @UseGuards(CustomerAuthGuard)
  async myOrders(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession) {
    return this.orders.mine(await this.place(slug, s), s.customerId);
  }

  @Get('me/orders/:id')
  @UseGuards(CustomerAuthGuard)
  async myOrder(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Param('id', uuid) id: string) {
    return this.orders.mineOne(await this.place(slug, s), s.customerId, id);
  }

  @Post('me/orders/:id/cancel')
  @UseGuards(CustomerAuthGuard)
  async cancelMine(@Param('slug') slug: string, @CurrentCustomer() s: CustomerSession, @Param('id', uuid) id: string) {
    return this.orders.cancelMine(await this.place(slug, s), s.customerId, id);
  }

  /** Totem da loja: pedido sem login (nome para chamar; membro pelo celular ou cartão). */
  @Post('totem/orders')
  async totemOrder(@Param('slug') slug: string, @Body(new ZodValidationPipe(totemOrderSchema)) body: TotemOrderInput) {
    const t = await this.shop.tenant(slug);
    return this.orders.createFromTotem({ tenantId: t.tenantId, storeId: t.storeId }, body);
  }

  /** Painel de retirada (TV): só número e primeiro nome. */
  @Get('pickup')
  async pickup(@Param('slug') slug: string) {
    const t = await this.shop.tenant(slug);
    return this.orders.pickup({ tenantId: t.tenantId, storeId: t.storeId });
  }

  /** A loja do endereço tem que ser a mesma do token da cliente. */
  private async place(slug: string, s: CustomerSession) {
    const t = await this.shop.tenant(slug);
    if (t.tenantId !== s.tenantId) throw new UnauthorizedException('Sessão de outra loja: entre de novo');
    return { tenantId: t.tenantId, storeId: t.storeId };
  }
}
