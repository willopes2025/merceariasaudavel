-- Conciliação bancária (OFX), orçamento, comissão de vendedor e disparos pelo WhatsApp.
CREATE TABLE "bank_line" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "account_id" TEXT NOT NULL REFERENCES "financial_account"("id") ON DELETE CASCADE,
  "date" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "memo" TEXT NOT NULL DEFAULT '',
  "fitid" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pendente' CHECK ("status" IN ('pendente','conciliado','ignorado')),
  "entry_id" TEXT REFERENCES "account_entry"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bank_line_account_id_fitid_key" ON "bank_line"("account_id", "fitid");
CREATE INDEX "bank_line_tenant_id_account_id_date_idx" ON "bank_line"("tenant_id", "account_id", "date");

CREATE TABLE "budget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "month" DATE NOT NULL,
  "line_key" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL
);
CREATE UNIQUE INDEX "budget_tenant_id_month_line_key_key" ON "budget"("tenant_id", "month", "line_key");

ALTER TABLE "employee" ADD COLUMN "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;

CREATE TABLE "broadcast" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "name" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "segment" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'rascunho' CHECK ("status" IN ('rascunho','enviando','concluido','cancelado')),
  "total" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3)
);
CREATE INDEX "broadcast_tenant_id_created_at_idx" ON "broadcast"("tenant_id", "created_at");

CREATE TABLE "broadcast_recipient" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "broadcast_id" TEXT NOT NULL REFERENCES "broadcast"("id") ON DELETE CASCADE,
  "customer_id" TEXT REFERENCES "customer"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pendente' CHECK ("status" IN ('pendente','enviado','falhou')),
  "error" TEXT,
  "sent_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "broadcast_recipient_broadcast_id_phone_key" ON "broadcast_recipient"("broadcast_id", "phone");

CREATE INDEX IF NOT EXISTS "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_line','budget','broadcast','broadcast_recipient'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mercearia_app', t);
  END LOOP;
END $$;
