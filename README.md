# VISIO

ERP de ótica + CRM do grupo Seven: a operação de loja que hoje está no ssÓtica
e o atendimento que hoje está no Widezap, num sistema só. Mesma base técnica
do Soul ERP (`erp/` na branch do Soul): NestJS + Prisma + PostgreSQL, React +
Vite + Tailwind, Docker e Caddy na VPS.

Arquitetura completa, fases e decisões: documento "VISIO — Arquitetura do ERP
de Ótica + CRM".

## Estrutura

```
visio/
├── apps/
│   ├── api/          NestJS 11 + Prisma 6 (cliente sem motor nativo + driver pg)
│   │   ├── prisma/   schema, migrações (com RLS por organização) e seed
│   │   └── src/
│   │       ├── common/   auth (guard, JWT, permissões), isolamento no banco, erros, auditoria
│   │       └── modules/  iam (login, usuários, papéis), tenancy (lojas, operações)
│   └── web/          React 18 + Vite + Tailwind + TanStack Query
├── packages/
│   └── contracts/    schemas Zod e permissões, usados pela API e pelo front
├── scripts/          build-release, backup, teste ponta a ponta
├── Dockerfile        imagem única: API em /v1, sistema em /
└── docker-compose.prod.yml
```

## Fase 0 (esta entrega)

- Organização → lojas (Programa Seven, James & Jesse's) → operações (as 6 do grupo, com a loja que recebe o lead).
- Login com bloqueio após 5 erros, papéis padrão (proprietário, gerente de loja, vendedor, caixa, montador, optometrista) e lojas por pessoa.
- Permissão checada no servidor em toda rota e relida a cada minuto (tirar acesso vale sem novo login).
- Isolamento por organização em duas camadas: filtro na aplicação e RLS no PostgreSQL.
- Menu com os 12 grupos do sistema; o que ainda não existe mostra o que vai ter e em que fase.
- Auditoria de quem criou/alterou loja, operação e usuário.

## Rodar no computador

```bash
npm install
cp apps/api/.env.example apps/api/.env      # ajuste DATABASE_URL
npm run db:deploy && npm run db:seed        # com SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
npm run dev                                  # API em :3000, sistema em :5180
npm test                                     # testes unitários
npm run e2e                                  # ponta a ponta contra um Postgres local
```

Sem acesso ao servidor de binários do Prisma, use `PRISMA_JS_ENGINE=1` (motor
em WebAssembly) para `prisma generate`.

## Publicar

Ver [DEPLOY.md](DEPLOY.md).
