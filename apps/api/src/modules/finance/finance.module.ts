import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { DreService } from './dre.service';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { ReceivablesService } from './receivables.service';

@Module({ controllers: [FinanceController], providers: [FinanceService, ReceivablesService, DreService, LedgerService], exports: [FinanceService, ReceivablesService, DreService, LedgerService] })
export class FinanceModule {}
