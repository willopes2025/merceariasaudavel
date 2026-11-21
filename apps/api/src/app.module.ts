import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './common/audit.service';
import { AuthGuard } from './common/auth/auth.guard';
import { DomainExceptionFilter } from './common/errors/domain-exception.filter';
import { PrismaModule } from './common/prisma/prisma.module';
import { RequestContextMiddleware } from './common/tenancy/request-context.middleware';
import { HealthController } from './health.controller';
import { CustomersModule } from './modules/customers/customers.module';
import { IamModule } from './modules/iam/iam.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { CashModule } from './modules/cash/cash.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { ManagementModule } from './modules/management/management.module';
import { NotifyModule } from './modules/notify/notify.module';
import { ProductsModule } from './modules/products/products.module';
import { SalesModule } from './modules/sales/sales.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { GrowthModule } from './modules/growth/growth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { ShopModule } from './modules/shop/shop.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

/**
 * Mercearia Saudável — Fase 1 (loja física): acesso, clientes e clube,
 * produtos e estoque com lote, caixa e venda, nota fiscal, preparo e insumos,
 * financeiro, metas, painel e TV. Fase 2a: app do cliente e cardápio (shop).
 * Loja online, marketplaces e iFood entram como módulos novos aqui.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    IamModule,
    TenancyModule,
    CustomersModule,
    CashModule,
    FinanceModule,
    FiscalModule,
    NotifyModule,
    ProductsModule,
    SalesModule,
    KitchenModule,
    ManagementModule,
    OrdersModule,
    ShopModule,
    CampaignsModule,
    GrowthModule,
    PurchasingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
