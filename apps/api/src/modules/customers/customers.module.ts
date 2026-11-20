import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

/** Todo dia de madrugada: baixa o cashback que venceu. */
@Injectable()
export class CashbackExpiryJob {
  private readonly logger = new Logger('Cashback');
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
  ) {}

  @Cron('0 15 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async run(): Promise<void> {
    for (const t of await this.prisma.tenant.findMany({ select: { id: true } })) {
      try {
        const total = await this.customers.expireCashback(t.id);
        if (total) this.logger.log(`Cashback vencido baixado: R$ ${total.toFixed(2)} (${t.id})`);
      } catch (e) {
        this.logger.error(`Falha ao vencer cashback de ${t.id}: ${(e as Error).message}`);
      }
    }
  }
}

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CashbackExpiryJob],
  exports: [CustomersService],
})
export class CustomersModule {}
