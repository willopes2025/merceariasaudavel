import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS, campaignSchema, type CampaignInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CampaignsService } from './campaigns.service';

const uuid = new ParseUUIDPipe();

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequiresPermission(PERMISSIONS.campaignManage)
  list(@Ctx() ctx: RequestContext) {
    return this.campaigns.list(ctx);
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.campaignManage)
  get(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.campaigns.get(ctx, id);
  }

  @Post()
  @RequiresPermission(PERMISSIONS.campaignManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(campaignSchema)) body: CampaignInput) {
    return this.campaigns.save(ctx, null, body);
  }

  @Put(':id')
  @RequiresPermission(PERMISSIONS.campaignManage)
  update(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(campaignSchema)) body: CampaignInput) {
    return this.campaigns.save(ctx, id, body);
  }
}
