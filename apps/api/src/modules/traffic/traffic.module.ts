import { Module } from '@nestjs/common';
import { TrafficController } from './traffic.controller';
import { TrafficService } from './traffic.service';

/** Fluxo de pessoas (câmeras) e conversão do balcão. */
@Module({ controllers: [TrafficController], providers: [TrafficService] })
export class TrafficModule {}
