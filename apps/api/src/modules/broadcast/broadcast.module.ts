import { Module } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';

/** Disparos de WhatsApp e origem dos anúncios. */
@Module({ controllers: [BroadcastController], providers: [BroadcastService] })
export class BroadcastModule {}
