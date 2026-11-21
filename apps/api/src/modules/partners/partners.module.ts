import { Module } from '@nestjs/common';
import { PartnerPortalController, PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({ controllers: [PartnersController, PartnerPortalController], providers: [PartnersService] })
export class PartnersModule {}
