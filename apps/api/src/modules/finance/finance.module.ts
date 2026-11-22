import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { ControlController } from './control.controller';
import { ControlService } from './control.service';
import { DreService } from './dre.service';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { ReceivablesService } from './receivables.service';

@Module({ controllers: [FinanceController, ControlController], providers: [ControlService, FinanceService, ReceivablesService, DreService, LedgerService], exports: [FinanceService, ReceivablesService, DreService, LedgerService] })
export class FinanceModule {}
