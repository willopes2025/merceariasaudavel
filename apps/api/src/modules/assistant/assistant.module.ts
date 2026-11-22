import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { FinanceModule } from '../finance/finance.module';
import { GrowthModule } from '../growth/growth.module';
import { IamModule } from '../iam/iam.module';
import { ManagementModule } from '../management/management.module';
import { PartnersModule } from '../partners/partners.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { EmailService } from './email.service';
import { FerramentasAssistente } from './tools';

/** Assistente da equipe (texto e voz), portado do assistente da Aritana e adaptado à Mercearia. */
@Module({
  imports: [IamModule, ManagementModule, GrowthModule, FinanceModule, PartnersModule, CampaignsModule, PurchasingModule],
  controllers: [AssistantController],
  providers: [AssistantService, FerramentasAssistente, EmailService],
})
export class AssistantModule {}
