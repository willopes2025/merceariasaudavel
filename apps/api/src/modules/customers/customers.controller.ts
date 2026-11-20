import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS, clubSettingsSchema, customerListQuery, customerSchema, type ClubSettings, type CustomerInput, type CustomerListQuery } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CustomersService } from './customers.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('customers')
  @RequiresPermission(PERMISSIONS.customerView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(customerListQuery)) query: CustomerListQuery) {
    return this.customers.list(ctx, query);
  }

  /** Busca do caixa: celular, CPF ou nome. */
  @Get('customers/search')
  @RequiresPermission(PERMISSIONS.saleCreate)
  search(@Ctx() ctx: RequestContext, @Query('q') q?: string) {
    return this.customers.search(ctx, String(q ?? '').slice(0, 80));
  }

  /** Já existe alguém com este CPF ou celular? (antes de cadastrar) */
  @Get('customers/lookup')
  @RequiresPermission(PERMISSIONS.customerView)
  lookup(@Ctx() ctx: RequestContext, @Query('document') document?: string, @Query('phone') phone?: string, @Query('except') except?: string) {
    return this.customers.lookup(ctx, document, phone, except);
  }

  @Get('customers/:id')
  @RequiresPermission(PERMISSIONS.customerView)
  get(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.customers.get(ctx, id);
  }

  @Get('customers/:id/timeline')
  @RequiresPermission(PERMISSIONS.customerView)
  timeline(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.customers.timeline(ctx, id);
  }

  @Get('customers/:id/cashback')
  @RequiresPermission(PERMISSIONS.customerView)
  cashback(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.customers.cashback(ctx, id);
  }

  @Post('customers')
  @RequiresPermission(PERMISSIONS.customerManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(customerSchema)) body: CustomerInput) {
    return this.customers.create(ctx, body);
  }

  @Put('customers/:id')
  @RequiresPermission(PERMISSIONS.customerManage)
  update(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(customerSchema)) body: CustomerInput) {
    return this.customers.update(ctx, id, body);
  }

  /** Regras do clube: qualquer pessoa logada lê (o caixa precisa); só configuração altera. */
  @Get('club')
  club(@Ctx() ctx: RequestContext) {
    return this.customers.club(ctx);
  }

  @Put('club')
  @RequiresPermission(PERMISSIONS.settingsManage)
  saveClub(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(clubSettingsSchema)) body: ClubSettings) {
    return this.customers.saveClub(ctx, body);
  }
}
