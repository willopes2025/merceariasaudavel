import { Global, Module } from '@nestjs/common';
import { IaService } from './ai.service';

@Global()
@Module({ providers: [IaService], exports: [IaService] })
export class AiModule {}
