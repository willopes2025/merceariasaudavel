// Carga inicial do Mercearia. Pode rodar quantas vezes quiser: só cria o que falta
// e nunca sobrescreve o que foi editado na tela (lojas, categorias, usuários).
//
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... SEED_ADMIN_NAME=... npm run db:seed
//
// Sem SEED_ADMIN_* não cria usuário (e avisa se a organização ainda não tem nenhum).

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import contracts from '@mercearia/contracts';

const { SYSTEM_ROLES } = contracts;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Mercearia Saudável';

const STORES = [{ code: 'loja', name: 'Mercearia Saudável' }];

const { DEFAULT_PAYMENT_METHODS } = contracts;

// Categorias de partida; a loja edita depois em Produtos › Categorias.
const CATEGORIES = ['Suplementos', 'Proteínas', 'Barrinhas e snacks', 'Granel', 'Bebidas', 'Pacco (garrafas e potes)', 'Shakes', 'Sorvetes e açaí', 'Insumos do preparo', 'Vitaminas'];

async function main() {
  // Papéis do sistema: sempre alinhados ao código (são os únicos que o seed atualiza).
  for (const role of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({ where: { tenantId: null, code: role.code } });
    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: { name: role.name, description: role.description, permissions: role.permissions },
      });
    } else {
      await prisma.role.create({ data: { tenantId: null, ...role } });
    }
  }

  let tenant = await prisma.tenant.findFirst({ where: { name: TENANT_NAME } });
  if (!tenant) tenant = await prisma.tenant.create({ data: { name: TENANT_NAME } });

  const storeIds = {};
  for (const s of STORES) {
    const store =
      (await prisma.store.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: s.code } } })) ??
      (await prisma.store.create({ data: { tenantId: tenant.id, ...s } }));
    storeIds[s.code] = store.id;
  }

  await prisma.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((m) => ({ tenantId: tenant.id, ...m })), skipDuplicates: true });
  await prisma.productCategory.createMany({ data: CATEGORIES.map((name) => ({ tenantId: tenant.id, name })), skipDuplicates: true });
  // Clube nasce com cashback desligado: a loja define em Configurações › Clube.
  await prisma.tenantSetting.upsert({ where: { tenantId: tenant.id }, create: { tenantId: tenant.id }, update: {} });

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 8) throw new Error('SEED_ADMIN_PASSWORD precisa ter pelo menos 8 caracteres');
    // Já aconteceu de o exemplo da documentação ser colado sem trocar.
    if (/^(seu|seu-email|email)@|@dominio\.com$|@email\.com$/.test(email) || /senha-forte|sua-senha|cole-/i.test(password)) {
      throw new Error('Troque o e-mail e a senha de exemplo pelos seus de verdade antes de rodar.');
    }
    const exists = await prisma.appUser.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } });
    if (!exists) {
      const owner = await prisma.role.findFirstOrThrow({ where: { tenantId: null, code: 'owner' } });
      await prisma.appUser.create({
        data: {
          tenantId: tenant.id,
          name: process.env.SEED_ADMIN_NAME ?? 'Administrador',
          email,
          passwordHash: await argon2.hash(password),
          roleId: owner.id,
        },
      });
      console.log(`→ proprietário criado: ${email}`);
    } else {
      console.log(`→ ${email} já existe (senha não alterada)`);
    }
  } else if ((await prisma.appUser.count({ where: { tenantId: tenant.id } })) === 0) {
    console.warn('! Nenhum usuário ainda. Rode de novo com SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD.');
  }

  console.log(`→ ${TENANT_NAME}: ${STORES.length} loja, ${CATEGORIES.length} categorias, ${SYSTEM_ROLES.length} papéis`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
