import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
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
import { ShopService } from './shop.service';

/**
 * App do cliente e cardápio: /v1/shop/:slug/...
 * Vitrine e cadastro são abertos; "minha conta" pede o token do cliente.
 * O token da equipe não serve aqui (e o do cliente não serve nas rotas da equipe).
 */
@Public()
@Controller('shop/:slug')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get()
  info(@Param('slug') slug: string) {
    return this.shop.info(slug);
  }

  @Get('catalog')
  catalog(@Param('slug') slug: string) {
    return this.shop.catalog(slug);
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
}
