import { Module } from '@nestjs/common';
import { ShopModule } from '../shop/shop.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({ imports: [ShopModule], controllers: [StorefrontController], providers: [StorefrontService], exports: [StorefrontService] })
export class StorefrontModule {}
