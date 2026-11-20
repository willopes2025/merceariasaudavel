import { Controller, Get } from '@nestjs/common';
import type { Features } from '@mercearia/contracts';
import { WhatsappSender } from './modules/notify/whatsapp.sender';
import { Public } from './common/auth/decorators';
import { PrismaService } from './common/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappSender,
  ) {}

  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', app: 'mercearia', version: process.env.APP_VERSION ?? 'dev', at: new Date().toISOString() };
  }

  /** O que está ligado neste servidor. A tela só oferece o que funciona de verdade. */
  @Public()
  @Get('features')
  features(): Features {
    return { whatsapp: this.whatsapp.enabled };
  }
}
