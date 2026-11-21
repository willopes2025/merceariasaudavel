import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, kitSchema, partnerCloseSchema, partnerSchema, todayBR, type KitInput, type PartnerCloseInput, type PartnerInput } from '@mercearia/contracts';
import { Ctx, Public, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PartnersService } from './partners.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get('partners')
  @RequiresPermission(PERMISSIONS.partnerManage)
  list(@Ctx() ctx: RequestContext, @Query('month') month?: string) {
    return this.partners.list(ctx, month && /^\d{4}-\d{2}$/.test(month) ? month : todayBR().slice(0, 7));
  }

  @Post('partners')
  @RequiresPermission(PERMISSIONS.partnerManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(partnerSchema)) body: PartnerInput) {
    return this.partners.save(ctx, null, body);
  }

  @Put('partners/:id')
  @RequiresPermission(PERMISSIONS.partnerManage)
  update(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(partnerSchema)) body: PartnerInput) {
    return this.partners.save(ctx, id, body);
  }

  @Post('partners/:id/rotate')
  @RequiresPermission(PERMISSIONS.partnerManage)
  rotate(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.partners.rotate(ctx, id);
  }

  /** Fecha a comissão do mês (vira conta a pagar). */
  @Post('partners/:id/close')
  @RequiresPermission(PERMISSIONS.financeManage)
  close(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(partnerCloseSchema)) body: PartnerCloseInput) {
    return this.partners.close(ctx, id, body);
  }

  @Get('kits')
  @RequiresPermission(PERMISSIONS.partnerManage)
  kits(@Ctx() ctx: RequestContext) {
    return this.partners.kits(ctx);
  }

  @Post('kits')
  @RequiresPermission(PERMISSIONS.partnerManage)
  createKit(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(kitSchema)) body: KitInput) {
    return this.partners.saveKit(ctx, null, body);
  }

  @Put('kits/:id')
  @RequiresPermission(PERMISSIONS.partnerManage)
  updateKit(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(kitSchema)) body: KitInput) {
    return this.partners.saveKit(ctx, id, body);
  }
}

/** Portal do parceiro (pelo link). */
@Public()
@Controller('partner-portal/:token')
export class PartnerPortalController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  portal(@Param('token') token: string) {
    return this.partners.portal(token);
  }
}
