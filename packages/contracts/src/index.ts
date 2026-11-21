import { z } from 'zod';

/**
 * Contratos compartilhados entre a API e o front: o mesmo schema valida o
 * formulário na tela e a requisição no servidor, então os dois nunca divergem.
 */

// ------------------------------------------------------------- permissões

/** Permissões checadas no servidor. O front só esconde o que vai ser negado. */
export const PERMISSIONS = {
  settingsManage: 'settings.manage',
  userManage: 'user.manage',
  customerView: 'customer.view',
  customerManage: 'customer.manage',
  saleCreate: 'sale.create',
  saleCancel: 'sale.cancel',
  /** Dar desconto manual no caixa. */
  saleDiscount: 'sale.discount',
  cashOperate: 'cash.operate',
  cashClose: 'cash.close',
  financeView: 'finance.view',
  financeManage: 'finance.manage',
  stockView: 'stock.view',
  stockAdjust: 'stock.adjust',
  /** Lançar perda e contar os insumos do dia. */
  stockLoss: 'stock.loss',
  /** Cadastrar produtos, preços e fichas técnicas. */
  productManage: 'product.manage',
  fiscalView: 'fiscal.view',
  fiscalEmit: 'fiscal.emit',
  fiscalCancel: 'fiscal.cancel',
  reportView: 'report.view',
  goalManage: 'goal.manage',
  orderPrepare: 'order.prepare',
  campaignManage: 'campaign.manage',
  purchaseManage: 'purchase.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/** Rótulo de cada permissão, para a tela de papéis. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'settings.manage': 'Configurar a loja',
  'user.manage': 'Gerenciar usuários',
  'customer.view': 'Ver clientes',
  'customer.manage': 'Cadastrar clientes e membros',
  'sale.create': 'Vender no caixa',
  'sale.cancel': 'Cancelar venda',
  'sale.discount': 'Dar desconto',
  'cash.operate': 'Operar o caixa',
  'cash.close': 'Fechar o caixa',
  'finance.view': 'Ver o financeiro',
  'finance.manage': 'Lançar e baixar no financeiro',
  'stock.view': 'Ver estoque',
  'stock.adjust': 'Dar entrada e acertar estoque',
  'stock.loss': 'Lançar perdas e contar insumos',
  'product.manage': 'Cadastrar produtos, preços e fichas técnicas',
  'fiscal.view': 'Ver notas fiscais',
  'fiscal.emit': 'Emitir nota fiscal',
  'fiscal.cancel': 'Cancelar nota fiscal',
  'report.view': 'Ver painéis e relatórios',
  'goal.manage': 'Definir metas e telas de TV',
  'order.prepare': 'Tela de preparo: andar com os pedidos',
  'campaign.manage': 'Criar campanhas, cupons e ofertas',
  'purchase.manage': 'Fornecedores e pedidos de compra',
};

/**
 * Papéis padrão do sistema. A organização pode criar os seus depois; estes
 * nascem com o banco (seed) e não são editáveis pela aplicação.
 */
export const SYSTEM_ROLES: Array<{ code: string; name: string; description: string; permissions: string[] }> = [
  {
    code: 'owner',
    name: 'Proprietária',
    description: 'Acesso total, inclusive configurações e usuários.',
    permissions: ['*'],
  },
  {
    code: 'store_manager',
    name: 'Gerente',
    description: 'Toca a loja: equipe, caixa, estoque, produtos, metas e relatórios.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'settings.manage'),
  },
  {
    code: 'seller',
    name: 'Atendente',
    description: 'Atende no balcão, vende e cadastra membros.',
    permissions: ['customer.view', 'customer.manage', 'sale.create', 'cash.operate', 'stock.view', 'fiscal.view', 'fiscal.emit', 'order.prepare'],
  },
  {
    code: 'cashier',
    name: 'Caixa',
    description: 'Vende, recebe, opera e fecha o caixa.',
    permissions: ['customer.view', 'customer.manage', 'sale.create', 'cash.operate', 'cash.close', 'stock.view', 'fiscal.view', 'fiscal.emit', 'order.prepare'],
  },
  {
    code: 'kitchen',
    name: 'Preparo (shakes e sorvetes)',
    description: 'Tela de preparo dos pedidos, estoque de insumos, perdas e contagem do dia.',
    permissions: ['stock.view', 'stock.loss', 'order.prepare'],
  },
];

// ------------------------------------------------------------- autenticação

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'A senha tem pelo menos 8 caracteres'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  tenantName: string;
  permissions: string[];
  /** Lojas em que a pessoa trabalha; vazio = todas. */
  storeIds: string[];
}

export interface LoginResult {
  accessToken: string;
  user: SessionUser;
}

// ------------------------------------------------------------- lojas

const code = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Código com pelo menos 2 letras')
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'Use letras minúsculas, números e hífen');

export const storeSchema = z.object({
  code,
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  cnpj: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 14, 'CNPJ com 14 dígitos')
    .optional()
    .transform((v) => (v ? v : null)),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  active: z.boolean().default(true),
  /** Loja que guarda o estoque desta (estoque compartilhado). Vazio = estoque próprio. */
  stockStoreId: z.string().uuid().optional().nullable(),
});
export type StoreInput = z.infer<typeof storeSchema>;

export interface Store {
  id: string;
  code: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  stockStoreId: string | null;
}

/** Lojas que têm estoque próprio, com o nome de quem divide o estoque com elas. */
export function stockStores<T extends { id: string; name: string; stockStoreId: string | null }>(stores: T[]): T[] {
  return stores
    .filter((s) => !s.stockStoreId)
    .map((s) => ({ ...s, name: [s.name, ...stores.filter((d) => d.stockStoreId === s.id).map((d) => d.name)].join(' + ') }));
}

// ------------------------------------------------------------- usuários

export const userCreateSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'A senha tem pelo menos 8 caracteres').max(200),
  whatsapp: z.string().trim().max(30).optional().nullable(),
  roleCode: z.string().min(2),
  /** Vazio = todas as lojas. */
  storeIds: z.array(z.string().uuid()).default([]),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = userCreateSchema
  .omit({ password: true })
  .extend({
    password: z.string().min(8, 'A senha tem pelo menos 8 caracteres').max(200).optional(),
    active: z.boolean().default(true),
  });
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export interface UserRow {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  active: boolean;
  roleCode: string | null;
  roleName: string | null;
  storeIds: string[];
  lastLoginAt: string | null;
}

export interface RoleRow {
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
}

// ------------------------------------------------------------- erros

/** Envelope único de erro da API: { error: { code, message, details, traceId } }. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; traceId: string };
}

export * from './br';
export * from './customers';
export * from './cash';
export * from './products';
export * from './sales';
export * from './kitchen';
export * from './goals';
export * from './finance';
export * from './fiscal';
export * from './stock-entry';

/** O que está ligado neste servidor. A tela só oferece o que funciona de verdade. */
export interface Features {
  /** Há canal de WhatsApp conectado? Sem ele nada é enviado. */
  whatsapp: boolean;
}
export * from './shop';
export * from './orders';
export * from './campaigns';
export * from './growth';
export * from './purchasing';
export * from './delivery';
