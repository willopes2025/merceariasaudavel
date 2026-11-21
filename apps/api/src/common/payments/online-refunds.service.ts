import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway } from './payment-gateway';

/**
 * Devoluções e cancelamentos no provedor, usados pela venda (cancelar venda
 * paga online) e pelo pedido (cancelar pedido com Pix aberto ou já pago).
 */
@Injectable()
export class OnlineRefunds {
  private readonly logger = new Logger('Pagamento online');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  /** Devolve um pagamento aprovado. Falha → erro (quem chamou não segue). */
  async refund(tenantId: string, paymentRowId: string): Promise<void> {
    const row = await this.prisma.onlinePayment.findFirst({ where: { id: paymentRowId, tenantId } });
    if (!row || !['pago', 'divergente'].includes(row.status) || !row.providerPaymentId) return;
    const provider = this.gateway.provider;
    if (!provider || provider.name !== row.provider) throw new DomainError('PAY_PROVIDER_OFF', 'O provedor do pagamento online não está ligado no servidor: devolva pelo painel do Mercado Pago.');
    try {
      await provider.refund(row.providerPaymentId);
    } catch (e) {
      throw new DomainError('REFUND_FAILED', `Não consegui devolver o pagamento online: ${(e as Error).message}`);
    }
    await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { status: 'estornado' } });
    this.logger.log(`Pagamento ${row.id} devolvido (R$ ${Number(row.amount).toFixed(2)})`);
  }

  /** Pagamentos pagos de uma venda (para devolver ao cancelar). */
  async paidOfSale(tenantId: string, saleId: string) {
    return this.prisma.onlinePayment.findMany({ where: { tenantId, saleId, status: 'pago' } });
  }

  /** Pix/checkout ainda abertos do pedido: cancela aqui e no provedor (melhor esforço). */
  async cancelPending(tenantId: string, orderId: string): Promise<void> {
    const open = await this.prisma.onlinePayment.findMany({ where: { tenantId, orderId, status: 'pendente' } });
    for (const row of open) {
      await this.prisma.onlinePayment.updateMany({ where: { id: row.id, status: 'pendente' }, data: { status: 'cancelado' } });
      if (row.method === 'pix' && row.providerRef && this.gateway.provider?.name === row.provider) {
        await this.gateway.provider.cancel(row.providerRef).catch((e: Error) => this.logger.warn(`Pix ${row.id} não cancelado no provedor: ${e.message}`));
      }
    }
  }

  /** Pago pelo app e ainda sem venda. */
  async paidUnsettled(tenantId: string, orderId: string) {
    return this.prisma.onlinePayment.findFirst({ where: { tenantId, orderId, status: 'pago', saleId: null } });
  }

  /** Dinheiro recebido pelo app sem venda (pago ou com valor diferente). */
  async receivedUnsettled(tenantId: string, orderId: string) {
    return this.prisma.onlinePayment.findMany({ where: { tenantId, orderId, status: { in: ['pago', 'divergente'] }, saleId: null } });
  }
}
