import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CourierController, DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({ imports: [OrdersModule], controllers: [DeliveryController, CourierController], providers: [DeliveryService] })
export class DeliveryModule {}
