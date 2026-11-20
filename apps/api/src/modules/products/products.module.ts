import { Global, Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockEntriesController } from './stock-entries.controller';
import { StockEntriesService } from './stock-entries.service';

@Global()
@Module({ controllers: [ProductsController, StockEntriesController], providers: [ProductsService, StockEntriesService], exports: [ProductsService] })
export class ProductsModule {}
