import { Injectable, Logger } from '@nestjs/common';
import { MercadoPagoProvider } from './mercadopago';
import type { PaymentProvider } from './provider';
import { TestProvider } from './test-provider';

/**
 * Escolhe o provedor pelo .env do servidor (a chave nunca fica no banco):
 * MP_ACCESS_TOKEN → Mercado Pago; PAY_PROVIDER=teste → provedor de teste;
 * nada → pagamento online desligado.
 */
@Injectable()
export class PaymentGateway {
  private readonly logger = new Logger('Pagamento online');
  readonly provider: PaymentProvider | null;

  constructor() {
    const kind = (process.env.PAY_PROVIDER ?? '').trim().toLowerCase();
    const token = process.env.MP_ACCESS_TOKEN?.trim();
    if (kind === 'teste') this.provider = new TestProvider();
    else if (token) this.provider = new MercadoPagoProvider(token, process.env.MP_WEBHOOK_SECRET?.trim() || null);
    else this.provider = null;
    if (this.provider) this.logger.log(`Provedor: ${this.provider.name}${this.provider.testMode ? ' (teste)' : ''}`);
  }

  /** Endereço público do sistema (avisos do provedor e volta do checkout). */
  publicUrl(): string | null {
    const url = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
    return url && /^https?:\/\//.test(url) ? url : null;
  }

  webhookUrl(): string | null {
    const base = this.publicUrl();
    return base && this.provider?.name === 'mercadopago' ? `${base}/v1/payments/webhook/mercadopago` : null;
  }
}
