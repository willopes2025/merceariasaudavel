import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { PERMISSIONS, storefrontSettingsSchema, type StorefrontSettingsInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { StorefrontService } from './storefront.service';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('settings')
  @RequiresPermission(PERMISSIONS.settingsManage)
  settings(@Ctx() ctx: RequestContext) {
    return this.storefront.settings(ctx);
  }

  @Put('settings')
  @RequiresPermission(PERMISSIONS.settingsManage)
  save(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(storefrontSettingsSchema)) body: StorefrontSettingsInput) {
    return this.storefront.saveSettings(ctx, body);
  }

  /** Vendas e cadastros por origem (anúncio, Instagram, Google...). */
  @Get('origins')
  @RequiresPermission(PERMISSIONS.reportView)
  origins(@Ctx() ctx: RequestContext, @Query('days') days?: string) {
    const n = Number(days);
    return this.storefront.origins(ctx, [7, 30, 90, 365].includes(n) ? n : 30);
  }
}
