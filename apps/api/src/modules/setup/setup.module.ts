import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

/** Pendências de implantação. */
@Module({ controllers: [SetupController], providers: [SetupService] })
export class SetupModule {}
