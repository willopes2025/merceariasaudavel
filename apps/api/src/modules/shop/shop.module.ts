import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CustomerAuthGuard } from './customer-auth';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

@Module({ imports: [OrdersModule], controllers: [ShopController], providers: [ShopService, CustomerAuthGuard], exports: [ShopService, CustomerAuthGuard] })
export class ShopModule {}
