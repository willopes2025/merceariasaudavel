import { Global, Module } from '@nestjs/common';
import { WhatsappSender } from './whatsapp.sender';

@Global()
@Module({
  providers: [WhatsappSender],
  exports: [WhatsappSender],
})
export class NotifyModule {}
