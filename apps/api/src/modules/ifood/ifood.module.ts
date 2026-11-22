import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { IfoodController } from './ifood.controller';
import { IfoodService } from './ifood.service';

/** Pedidos do iFood. */
@Module({ imports: [SalesModule], controllers: [IfoodController], providers: [IfoodService] })
export class IfoodModule {}
