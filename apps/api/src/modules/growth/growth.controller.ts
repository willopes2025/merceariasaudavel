import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, contactSchema, growthMessagesSchema, type ContactInput, type GrowthMessagesInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { GrowthService } from './growth.service';

const int = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

@Controller('growth')
export class GrowthController {
  constructor(private readonly growth: GrowthService) {}

  @Get('summary')
  @RequiresPermission(PERMISSIONS.customerView)
  summary(@Ctx() ctx: RequestContext) {
    return this.growth.summary(ctx);
  }

  @Get('repurchase')
  @RequiresPermission(PERMISSIONS.customerView)
  repurchase(@Ctx() ctx: RequestContext, @Query('ahead') ahead?: string) {
    return this.growth.repurchase(ctx, int(ahead, 7, 0, 60));
  }

  @Get('lapsed')
  @RequiresPermission(PERMISSIONS.customerView)
  lapsed(@Ctx() ctx: RequestContext, @Query('days') days?: string) {
    return this.growth.lapsed(ctx, int(days, 45, 7, 365));
  }

  @Get('birthdays')
  @RequiresPermission(PERMISSIONS.customerView)
  birthdays(@Ctx() ctx: RequestContext, @Query('month') month?: string) {
    return this.growth.birthdays(ctx, int(month, new Date().getMonth() + 1, 1, 12));
  }

  @Post('contacts')
  @RequiresPermission(PERMISSIONS.customerView)
  contact(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(contactSchema)) body: ContactInput) {
    return this.growth.contact(ctx, body);
  }

  @Put('messages')
  @RequiresPermission(PERMISSIONS.campaignManage)
  saveMessages(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(growthMessagesSchema)) body: GrowthMessagesInput) {
    return this.growth.saveMessages(ctx, body);
  }
}
