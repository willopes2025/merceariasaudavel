import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS, broadcastSchema, broadcastSegmentSchema, reportQuery, type BroadcastInput, type BroadcastSegment, type ReportQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { BroadcastService } from './broadcast.service';

const uuid = new ParseUUIDPipe();

@Controller('broadcasts')
export class BroadcastController {
  constructor(private readonly service: BroadcastService) {}

  @RequiresPermission(PERMISSIONS.campaignManage)
  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx);
  }

  @RequiresPermission(PERMISSIONS.campaignManage)
  @Post('preview')
  preview(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(broadcastSegmentSchema)) seg: BroadcastSegment) {
    return this.service.preview(ctx, seg);
  }

  @RequiresPermission(PERMISSIONS.campaignManage)
  @Post()
  send(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(broadcastSchema)) d: BroadcastInput) {
    return this.service.send(ctx, d);
  }

  @RequiresPermission(PERMISSIONS.campaignManage)
  @Get('ads')
  ads(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(reportQuery)) q: ReportQuery) {
    return this.service.ads(ctx, q.from, q.to);
  }

  @RequiresPermission(PERMISSIONS.campaignManage)
  @Get(':id/recipients')
  recipients(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.service.recipients(ctx, id);
  }

  @RequiresPermission(PERMISSIONS.campaignManage)
  @Post(':id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.service.cancel(ctx, id);
  }
}
