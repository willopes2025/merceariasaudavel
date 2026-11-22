import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

/** Funcionários e controle de ponto. */
@Module({ imports: [FinanceModule], controllers: [HrController], providers: [HrService], exports: [HrService] })
export class HrModule {}
