import { Injectable } from '@nestjs/common';
import { SETUP_GROUPS, SETUP_KEYS, type SetupReport, type SetupStatus, type SetupUpdateInput } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

const q = (n: number, um: string, varios: string) => (n > 0 ? `${n} ${n === 1 ? um : varios}` : null);
const env = (k: string) => !!process.env[k]?.trim();

/** Pendências de implantação: a situação de cada item e o que o sistema já enxerga cadastrado. */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** O que dá para conferir sozinho, olhando os cadastros e as chaves do servidor. */
  private async detectar(t: string): Promise<Record<string, string | null>> {
    const p = this.prisma;
    const w = { tenantId: t };
    const [loja, fiscal, produtos, comMinimo, lotes, fichas, opcoes, fotos, fornecedores, clientes, parceiros, campanhas, taxas, contas, pagar, ofx, funcionarios, escalas, comissao, usuarios, feriados, bairros] = await Promise.all([
      p.store.findFirst({ where: { ...w, cnpj: { not: null } }, select: { cnpj: true } }),
      p.fiscalConfig.count({ where: w }).catch(() => 0),
      p.product.count({ where: { ...w, active: true } }),
      p.product.count({ where: { ...w, active: true, minStock: { gt: 0 } } }),
      p.stockLot.count({ where: { ...w, quantity: { gt: 0 } } }),
      p.recipeItem.groupBy({ by: ['productId'], where: w }).then((r) => r.length).catch(() => 0),
      p.optionGroup.count({ where: w }).catch(() => 0),
      p.product.count({ where: { ...w, active: true, imageUrl: { not: null } } }).catch(() => 0),
      p.supplier.count({ where: w }),
      p.customer.count({ where: w }),
      p.partner.count({ where: w }),
      p.campaign.count({ where: w }).catch(() => 0),
      p.paymentMethod.count({ where: { ...w, active: true, OR: [{ feePct: { gt: 0 } }, { feeFixed: { gt: 0 } }, { settleDays: { gt: 0 } }] } }),
      p.financialAccount.count({ where: { ...w, active: true, kind: { not: 'caixa' } } }),
      p.payable.count({ where: w }),
      p.bankLine.count({ where: w }),
      p.employee.count({ where: { ...w, active: true } }),
      p.workSchedule.count({ where: w }),
      p.employee.count({ where: { ...w, active: true, commissionPct: { gt: 0 } } }),
      p.appUser.count({ where: { ...w, status: 'active' } }),
      p.holiday.count({ where: w }),
      p.deliveryZone.count({ where: w }),
    ]);
    const chave = (ok: boolean) => (ok ? 'Chave cadastrada no servidor' : null);
    return {
      'empresa.dados': loja?.cnpj ? `CNPJ ${loja.cnpj} cadastrado` : null,
      'fiscal.certificado': fiscal ? 'Configuração fiscal preenchida' : null,
      'produtos.planilha': q(produtos, 'produto cadastrado', 'produtos cadastrados'),
      'produtos.minimo': q(comMinimo, 'produto com estoque mínimo', 'produtos com estoque mínimo'),
      'produtos.lotes': q(lotes, 'lote com saldo', 'lotes com saldo'),
      'produtos.fichas': q(fichas, 'produto com ficha técnica', 'produtos com ficha técnica'),
      'produtos.opcoes': q(opcoes, 'grupo de opções', 'grupos de opções'),
      'produtos.fotos': q(fotos, 'produto com foto', 'produtos com foto'),
      'produtos.fornecedores': q(fornecedores, 'fornecedor cadastrado', 'fornecedores cadastrados'),
      'clientes.planilha': q(clientes, 'cliente cadastrada', 'clientes cadastradas'),
      'clientes.parceiros': q(parceiros, 'parceiro cadastrado', 'parceiros cadastrados'),
      'clientes.campanhas': q(campanhas, 'campanha cadastrada', 'campanhas cadastradas'),
      'fin.taxas': q(taxas, 'forma de pagamento com taxa ou prazo', 'formas de pagamento com taxa ou prazo'),
      'fin.contas': q(contas, 'conta bancária cadastrada', 'contas bancárias cadastradas'),
      'fin.pagar': q(pagar, 'conta a pagar lançada', 'contas a pagar lançadas'),
      'fin.ofx': q(ofx, 'linha de extrato importada', 'linhas de extrato importadas'),
      'equipe.funcionarios': q(funcionarios, 'funcionário cadastrado', 'funcionários cadastrados'),
      'equipe.escala': q(escalas, 'escala cadastrada', 'escalas cadastradas'),
      'equipe.comissao': q(comissao, 'pessoa com comissão', 'pessoas com comissão'),
      'equipe.usuarios': usuarios > 1 ? `${usuarios} usuários ativos` : null,
      'equipe.feriados': q(feriados, 'feriado cadastrado', 'feriados cadastrados'),
      'entrega.bairros': q(bairros, 'área de entrega cadastrada', 'áreas de entrega cadastradas'),
      'int.mercadopago': chave(env('MP_ACCESS_TOKEN')),
      'int.whatsapp': chave(env('ZAPI_TOKEN') || env('META_WA_TOKEN')),
      'int.ifood': chave(env('IFOOD_CLIENT_ID') && env('IFOOD_CLIENT_SECRET') && env('IFOOD_MERCHANT_ID')),
      'int.email': chave(env('SMTP_HOST')),
      'int.cameras': env('TRAFFIC_SECRET') ? 'Entrada da contagem ligada no servidor' : null,
      'int.assistente': chave(env('ANTHROPIC_API_KEY')),
    };
  }

  async report(ctx: RequestContext): Promise<SetupReport> {
    const [salvos, vistos, usuarios] = await Promise.all([
      this.prisma.setupItem.findMany({ where: { tenantId: ctx.tenantId } }),
      this.detectar(ctx.tenantId),
      this.prisma.appUser.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    ]);
    const por = new Map(salvos.map((s) => [s.key, s]));
    const nome = new Map(usuarios.map((u) => [u.id, u.name]));
    const groups = SETUP_GROUPS.map((g) => ({
      group: g.group,
      hint: g.hint,
      items: g.items.map((i) => {
        const s = por.get(i.key);
        return { ...i, status: (s?.status ?? 'pendente') as SetupStatus, note: s?.note ?? null, updatedBy: s?.updatedById ? (nome.get(s.updatedById) ?? null) : null, updatedAt: s?.updatedAt.toISOString() ?? null, detected: vistos[i.key] ?? null };
      }),
    }));
    const todos = groups.flatMap((g) => g.items);
    return { groups, total: todos.length, done: todos.filter((i) => i.status === 'concluido' || i.status === 'nao_se_aplica').length, received: todos.filter((i) => i.status === 'recebido').length };
  }

  async update(ctx: RequestContext, key: string, d: SetupUpdateInput) {
    if (!SETUP_KEYS.includes(key)) throw new NotFoundError('pendência', key);
    const data = { status: d.status, note: d.note || null, updatedById: ctx.userId };
    await this.prisma.setupItem.upsert({ where: { tenantId_key: { tenantId: ctx.tenantId, key } }, create: { tenantId: ctx.tenantId, key, ...data }, update: data });
    await this.audit.record(ctx, 'setup.update', 'setup_item', key, { situacao: d.status });
    return { ok: true };
  }
}
