-- App do cliente (Fase 2a): endereço público, cartão de membro, acesso por PIN e vitrine do produto.

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "member_code" TEXT;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "description" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "show_in_app" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "customer_access" (
    "customer_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "must_change" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_access_pkey" PRIMARY KEY ("customer_id")
);

-- CreateIndex
CREATE INDEX "customer_access_tenant_id_idx" ON "customer_access"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_member_code_key" ON "customer"("tenant_id", "member_code");

-- AddForeignKey
ALTER TABLE "customer_access" ADD CONSTRAINT "customer_access_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Endereço público da organização que já existe.
UPDATE "tenant" SET "slug" = 'mercearia-saudavel' WHERE "slug" IS NULL AND "name" = 'Mercearia Saudável';
ALTER TABLE "tenant" ADD CONSTRAINT tenant_slug_check CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Isolamento por organização, igual às outras tabelas.
ALTER TABLE customer_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_access;
CREATE POLICY tenant_isolation ON customer_access
  USING ((SELECT app_tenant_visible(tenant_id::text)))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_access TO mercearia_app;

ALTER TABLE customer_access ADD CONSTRAINT customer_access_failed_check CHECK (failed_count >= 0);
ALTER TABLE customer ADD CONSTRAINT customer_member_code_check CHECK (member_code IS NULL OR member_code ~ '^[A-Z2-9]{6}$');
