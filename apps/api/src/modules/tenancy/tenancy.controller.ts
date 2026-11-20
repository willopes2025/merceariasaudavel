import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS, storeSchema, type StoreInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { TenancyService } from './tenancy.service';

@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  /** Qualquer pessoa logada vê as lojas (para escolher onde está trabalhando). */
  @Get('stores')
  stores(@Ctx() ctx: RequestContext) {
    return this.tenancy.stores(ctx);
  }

  @Post('stores')
  @RequiresPermission(PERMISSIONS.settingsManage)
  createStore(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(storeSchema)) body: StoreInput) {
    return this.tenancy.createStore(ctx, body);
  }

  @Put('stores/:id')
  @RequiresPermission(PERMISSIONS.settingsManage)
  updateStore(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(storeSchema)) body: StoreInput,
  ) {
    return this.tenancy.updateStore(ctx, id, body);
  }
}
