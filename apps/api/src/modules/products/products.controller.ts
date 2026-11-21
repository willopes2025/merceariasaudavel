import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  categorySchema,
  PERMISSIONS,
  productListQuery,
  productSchema,
  optionGroupsSchema,
  recipeSchema,
  stockMoveSchema,
  type CategoryInput,
  type ProductInput,
  type ProductListQuery,
  type OptionGroupsInput,
  type RecipeInput,
  type StockMoveInput,
} from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { DomainError } from '../../common/errors/domain-error';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ProductsService } from './products.service';

const uuid = new ParseUUIDPipe();
const optionalUuid = (v?: string) => {
  if (!v) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new DomainError('BAD_ID', 'Referência inválida.');
  return v;
};

@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  @RequiresPermission(PERMISSIONS.stockView)
  list(@Ctx() ctx: RequestContext, @Query(new ZodValidationPipe(productListQuery)) q: ProductListQuery) {
    return this.products.list(ctx, q);
  }

  /** Busca do caixa: código de barras exato ou nome. */
  @Get('products/lookup')
  @RequiresPermission(PERMISSIONS.saleCreate)
  lookup(@Ctx() ctx: RequestContext, @Query('q') q?: string, @Query('storeId') storeId?: string) {
    return this.products.lookup(ctx, String(q ?? '').slice(0, 80), optionalUuid(storeId));
  }

  @Get('products/expiring')
  @RequiresPermission(PERMISSIONS.stockView)
  expiring(@Ctx() ctx: RequestContext, @Query('days') days?: string, @Query('storeId') storeId?: string) {
    return this.products.expiring(ctx, Math.min(365, Math.max(0, Number(days ?? 30) || 30)), optionalUuid(storeId));
  }

  @Get('products/:id')
  @RequiresPermission(PERMISSIONS.stockView)
  get(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.products.get(ctx, id);
  }

  @Post('products')
  @RequiresPermission(PERMISSIONS.productManage)
  create(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(productSchema)) body: ProductInput) {
    return this.products.create(ctx, body);
  }

  @Put('products/:id')
  @RequiresPermission(PERMISSIONS.productManage)
  update(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(productSchema)) body: ProductInput) {
    return this.products.update(ctx, id, body);
  }

  @Put('products/:id/recipe')
  @RequiresPermission(PERMISSIONS.productManage)
  recipe(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(recipeSchema)) body: RecipeInput) {
    return this.products.saveRecipe(ctx, id, body);
  }

  @Put('products/:id/options')
  @RequiresPermission(PERMISSIONS.productManage)
  options(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(optionGroupsSchema)) body: OptionGroupsInput) {
    return this.products.saveOptions(ctx, id, body);
  }

  /** Entrada e acerto pedem stock.adjust; perda pede stock.loss (a equipe do preparo lança). */
  @Post('products/:id/stock')
  @RequiresPermission(PERMISSIONS.stockView)
  move(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(stockMoveSchema)) body: StockMoveInput) {
    const needed = body.type === 'perda' ? PERMISSIONS.stockLoss : PERMISSIONS.stockAdjust;
    if (!ctx.permissions.includes('*') && !ctx.permissions.includes(needed)) throw new DomainError('FORBIDDEN', 'Você não tem permissão para esse lançamento de estoque.', undefined, 403);
    return this.products.move(ctx, id, body);
  }

  @Get('categories')
  categories(@Ctx() ctx: RequestContext) {
    return this.products.categories(ctx);
  }

  @Post('categories')
  @RequiresPermission(PERMISSIONS.productManage)
  createCategory(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(categorySchema)) body: CategoryInput) {
    return this.products.saveCategory(ctx, null, body);
  }

  @Put('categories/:id')
  @RequiresPermission(PERMISSIONS.productManage)
  updateCategory(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(categorySchema)) body: CategoryInput) {
    return this.products.saveCategory(ctx, id, body);
  }
}
