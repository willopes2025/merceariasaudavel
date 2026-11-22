import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { ManagementController } from './management.controller';
import { ManagementService } from './management.service';

@Module({ controllers: [ManagementController], providers: [ManagementService, AlertsService], exports: [ManagementService] })
export class ManagementModule {}
