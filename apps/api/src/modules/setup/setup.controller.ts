import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { PERMISSIONS, setupUpdateSchema, type SetupUpdateInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { SetupService } from './setup.service';

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  @RequiresPermission(PERMISSIONS.settingsManage)
  report(@Ctx() ctx: RequestContext) {
    return this.setup.report(ctx);
  }

  @Put(':key')
  @RequiresPermission(PERMISSIONS.settingsManage)
  update(@Ctx() ctx: RequestContext, @Param('key') key: string, @Body(new ZodValidationPipe(setupUpdateSchema)) d: SetupUpdateInput) {
    return this.setup.update(ctx, key, d);
  }
}
