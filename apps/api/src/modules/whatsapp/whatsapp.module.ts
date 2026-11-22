import { Module } from '@nestjs/common';
import { ShopModule } from '../shop/shop.module';
import { WhatsappAgentService } from './whatsapp-agent.service';
import { WhatsappController, WhatsappWebhookController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

/** Atendimento no WhatsApp: conversas, agente de IA e carrinho por link. */
@Module({
  imports: [ShopModule],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, WhatsappAgentService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
