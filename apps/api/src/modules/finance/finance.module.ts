import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { DreService } from './dre.service';
import { FinanceService } from './finance.service';
import { ReceivablesService } from './receivables.service';

@Module({ controllers: [FinanceController], providers: [FinanceService, ReceivablesService, DreService], exports: [FinanceService, ReceivablesService, DreService] })
export class FinanceModule {}
