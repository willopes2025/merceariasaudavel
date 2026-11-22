import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSIONS } from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/tenancy/request-context';
import type { IfoodOrderData } from './ifood.api';
import { IfoodService } from './ifood.service';

@Controller('ifood')
export class IfoodController {
  constructor(private readonly ifood: IfoodService) {}

  @Get()
  @RequiresPermission(PERMISSIONS.orderPrepare)
  status(@Ctx() ctx: RequestContext) {
    return this.ifood.status(ctx);
  }

  @Post('orders/:id/retry')
  @RequiresPermission(PERMISSIONS.orderPrepare)
  retry(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ifood.retry(ctx, id);
  }

  /** Só no simulador (IFOOD_PROVIDER=teste): coloca um pedido ou um cancelamento na fila e já processa. */
  @Post('test')
  @RequiresPermission(PERMISSIONS.settingsManage)
  async test(@Body() body: { order?: IfoodOrderData; cancel?: string }) {
    const api = this.ifood.api;
    if (api?.kind !== 'teste') throw new DomainError('IFOOD_NOT_TEST', 'Disponível só no simulador.');
    const sim = api as unknown as { push(o: IfoodOrderData): void; cancel(id: string): void; actions: unknown[] };
    if (body.order) sim.push(body.order);
    if (body.cancel) sim.cancel(body.cancel);
    await this.ifood.tick();
    return { actions: sim.actions };
  }
}
