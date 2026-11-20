import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Migrações. Na VPS o Prisma usa o motor de migração normal. Com
 * PRISMA_JS_ENGINE=1 usa o motor em WebAssembly que vem no próprio pacote —
 * para máquinas sem acesso ao servidor de binários do Prisma.
 */
const js = process.env.PRISMA_JS_ENGINE === '1';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(js
    ? {
        experimental: { adapter: true },
        engine: 'js' as const,
        adapter: async () => new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      }
    : {}),
});
