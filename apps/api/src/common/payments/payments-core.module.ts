import { Global, Module } from '@nestjs/common';
import { OnlineRefunds } from './online-refunds.service';
import { PaymentGateway } from './payment-gateway';

@Global()
@Module({ providers: [PaymentGateway, OnlineRefunds], exports: [PaymentGateway, OnlineRefunds] })
export class PaymentsCoreModule {}
