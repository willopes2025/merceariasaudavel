import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ProductsModule } from '../products/products.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Auditoria e importação por planilha. */
@Module({ imports: [CustomersModule, ProductsModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
