import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS, saleCancelSchema, saleCreateSchema, saleListQuery, saleQuoteSchema, type SaleCancelInput, type SaleCreateInput, type SaleListQuery, type SaleQuoteInput } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { SalesService } from './sales.service';

const uuid = new ParseUUIDPipe();

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequiresPermission(PERMISSIONS.saleCreate)
  list(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(saleListQuery)) q: SaleListQuery) {
    return this.sales.list(ctx, q);
  }

  /** Conta a venda sem gravar (o caixa mostra o total que o servidor vai cobrar). */
  @Post('quote')
  @RequiresPermission(PERMISSIONS.saleCreate)
  quote(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(saleQuoteSchema)) body: SaleQuoteInput) {
    return this.sales.quote(ctx, body);
  }

  @Post()
  @RequiresPermission(PERMISSIONS.saleCreate, PERMISSIONS.cashOperate)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(saleCreateSchema)) body: SaleCreateInput) {
    return this.sales.create(ctx, body);
  }

  @Get(':id')
  @RequiresPermission(PERMISSIONS.saleCreate)
  get(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.sales.get(ctx, id);
  }

  @Post(':id/cancel')
  @RequiresPermission(PERMISSIONS.saleCancel)
  cancel(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(saleCancelSchema)) body: SaleCancelInput) {
    return this.sales.cancel(ctx, id, body);
  }
}
