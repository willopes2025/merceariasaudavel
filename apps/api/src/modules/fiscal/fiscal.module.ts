import { Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { FocusNfeClient } from './focus.client';

@Module({ controllers: [FiscalController], providers: [FiscalService, FocusNfeClient], exports: [FiscalService] })
export class FiscalModule {}
