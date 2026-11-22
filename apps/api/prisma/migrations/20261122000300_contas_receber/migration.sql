-- Contas a receber, taxas e prazos das formas de pagamento, configuração do DRE.
ALTER TABLE "payment_method"
  ADD COLUMN IF NOT EXISTS "fee_pct" DECIMAL(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "fee_fixed" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "settle_days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reconcile" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_fee_check" CHECK ("fee_pct" >= 0 AND "fee_pct" < 100 AND "fee_fixed" >= 0 AND "settle_days" BETWEEN 0 AND 365);

-- Pontos de partida comuns (cada loja ajusta para as taxas da sua maquininha).
UPDATE "payment_method" SET "fee_pct" = 1.5, "settle_days" = 1 WHERE "kind" = 'debito';
UPDATE "payment_method" SET "fee_pct" = 3.5, "settle_days" = 30 WHERE "kind" = 'credito';
UPDATE "payment_method" SET "fee_pct" = 0.99 WHERE "name" = 'Pix online';

ALTER TABLE "tenant_setting" ADD COLUMN IF NOT EXISTS "finance_config" JSONB;

CREATE TABLE "receivable" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "store_id" TEXT REFERENCES "store"("id"),
  "movement_id" TEXT UNIQUE REFERENCES "cash_movement"("id"),
  "sale_id" TEXT REFERENCES "sale"("id"),
  "method_id" TEXT REFERENCES "payment_method"("id"),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('venda', 'estorno', 'avulso')),
  "description" TEXT NOT NULL,
  "gross" DECIMAL(12,2) NOT NULL,
  "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "net" DECIMAL(12,2) NOT NULL,
  "sale_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'aberto' CHECK ("status" IN ('aberto', 'recebido', 'cancelado')),
  "received_date" DATE,
  "received_amount" DECIMAL(12,2),
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "receivable_tenant_id_due_date_idx" ON "receivable"("tenant_id", "due_date");
CREATE INDEX "receivable_tenant_id_sale_date_idx" ON "receivable"("tenant_id", "sale_date");
CREATE INDEX "receivable_sale_id_idx" ON "receivable"("sale_id");

ALTER TABLE "receivable" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "receivable";
CREATE POLICY tenant_isolation ON "receivable" USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "receivable" TO mercearia_app;
