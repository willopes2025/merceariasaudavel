import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS, userCreateSchema, userUpdateSchema, type UserCreateInput, type UserUpdateInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('roles')
  @RequiresPermission(PERMISSIONS.userManage)
  roles(@Ctx() ctx: RequestContext) {
    return this.users.roles(ctx);
  }

  /** Equipe ativa (só nome): para escolher vendedor, responsável etc. Qualquer pessoa logada. */
  @Get('team')
  team(@Ctx() ctx: RequestContext) {
    return this.users.team(ctx);
  }

  @Get('users')
  @RequiresPermission(PERMISSIONS.userManage)
  list(@Ctx() ctx: RequestContext) {
    return this.users.list(ctx);
  }

  @Post('users')
  @RequiresPermission(PERMISSIONS.userManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(userCreateSchema)) body: UserCreateInput) {
    return this.users.create(ctx, body);
  }

  @Put('users/:id')
  @RequiresPermission(PERMISSIONS.userManage)
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(userUpdateSchema)) body: UserUpdateInput,
  ) {
    return this.users.update(ctx, id, body);
  }
}
