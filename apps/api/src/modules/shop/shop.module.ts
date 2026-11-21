import { Module } from '@nestjs/common';
import { CustomerAuthGuard } from './customer-auth';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

@Module({ controllers: [ShopController], providers: [ShopService, CustomerAuthGuard] })
export class ShopModule {}
