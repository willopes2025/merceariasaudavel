import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SalesModule } from '../sales/sales.module';
import { ShopModule } from '../shop/shop.module';
import { PaymentsController, PaymentsWebhookController, ShopPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({ imports: [SalesModule, OrdersModule, ShopModule], controllers: [PaymentsController, PaymentsWebhookController, ShopPaymentsController], providers: [PaymentsService] })
export class PaymentsModule {}
