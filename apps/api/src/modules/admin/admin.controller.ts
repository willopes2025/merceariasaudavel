import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PERMISSIONS, auditQuery, importSchema, type AuditQuery, type ImportInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import { ForbiddenError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AdminService } from './admin.service';

@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('audit')
  @RequiresPermission(PERMISSIONS.userManage)
  audit(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(auditQuery)) q: AuditQuery) {
    return this.admin.auditLog(ctx, q);
  }

  @Post('import')
  @RequiresPermission(PERMISSIONS.settingsManage)
  import(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(importSchema)) d: ImportInput) {
    if (!ctx.permissions.includes('*') && !ctx.permissions.includes(d.kind === 'produtos' ? PERMISSIONS.productManage : PERMISSIONS.customerManage)) throw new ForbiddenError('FORBIDDEN', 'Sem permissão para importar.');
    return this.admin.import(ctx, d);
  }
}
