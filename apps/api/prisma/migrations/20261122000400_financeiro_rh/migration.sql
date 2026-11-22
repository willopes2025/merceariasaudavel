-- Plano de contas, contas financeiras com extrato, contas a pagar detalhadas, funcionários e ponto.
CREATE TABLE "chart_account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dre_line" TEXT NOT NULL CHECK ("dre_line" IN ('receita','deducao','custo','despesa_venda','despesa_operacional','financeira_receita','financeira_despesa','imposto_lucro','fora')),
  "cash_only" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "chart_account_tenant_id_code_key" ON "chart_account"("tenant_id", "code");

CREATE TABLE "financial_account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'banco' CHECK ("kind" IN ('caixa','banco','carteira')),
  "bank" TEXT, "agency" TEXT, "number" TEXT, "pix_key" TEXT,
  "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "opening_date" DATE NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "financial_account_tenant_id_name_key" ON "financial_account"("tenant_id", "name");

CREATE TABLE "employee" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "store_id" TEXT REFERENCES "store"("id"),
  "user_id" TEXT UNIQUE REFERENCES "app_user"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "cpf" TEXT, "role" TEXT, "phone" TEXT, "email" TEXT,
  "birth_date" DATE,
  "admission" DATE NOT NULL,
  "dismissal" DATE,
  "contract" TEXT NOT NULL DEFAULT 'clt' CHECK ("contract" IN ('clt','estagio','pj','autonomo','socio')),
  "salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pay_day" INTEGER NOT NULL DEFAULT 5 CHECK ("pay_day" BETWEEN 1 AND 31),
  "pix_key" TEXT,
  "schedule_id" TEXT,
  "clocks" BOOLEAN NOT NULL DEFAULT true,
  "pin_hash" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "employee_tenant_id_active_name_idx" ON "employee"("tenant_id", "active", "name");
CREATE UNIQUE INDEX "employee_tenant_cpf_key" ON "employee"("tenant_id", "cpf") WHERE "cpf" IS NOT NULL;

ALTER TABLE "payable"
  ADD COLUMN "chart_account_id" TEXT REFERENCES "chart_account"("id"),
  ADD COLUMN "supplier_id" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL,
  ADD COLUMN "employee_id" TEXT REFERENCES "employee"("id") ON DELETE SET NULL,
  ADD COLUMN "competence" DATE,
  ADD COLUMN "account_id" TEXT REFERENCES "financial_account"("id"),
  ADD COLUMN "document" TEXT;
UPDATE "payable" SET "competence" = "due_date" WHERE "competence" IS NULL;
CREATE INDEX "payable_tenant_competence_idx" ON "payable"("tenant_id", "competence");
ALTER TABLE "payment_method" ADD COLUMN "account_id" TEXT REFERENCES "financial_account"("id");
ALTER TABLE "receivable" ADD COLUMN "chart_account_id" TEXT REFERENCES "chart_account"("id"), ADD COLUMN "account_id" TEXT REFERENCES "financial_account"("id");
ALTER TABLE "tenant_setting" ADD COLUMN IF NOT EXISTS "hr_config" JSONB;

CREATE TABLE "account_entry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "account_id" TEXT NOT NULL REFERENCES "financial_account"("id"),
  "date" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('pagamento','recebimento','transferencia','ajuste')),
  "description" TEXT NOT NULL,
  "payable_id" TEXT UNIQUE REFERENCES "payable"("id") ON DELETE CASCADE,
  "receivable_id" TEXT UNIQUE REFERENCES "receivable"("id") ON DELETE CASCADE,
  "transfer_id" TEXT,
  "user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "account_entry_tenant_id_account_id_date_idx" ON "account_entry"("tenant_id", "account_id", "date");

CREATE TABLE "work_schedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "name" TEXT NOT NULL,
  "days" JSONB NOT NULL,
  "tolerance_punch" INTEGER NOT NULL DEFAULT 5,
  "tolerance_day" INTEGER NOT NULL DEFAULT 10,
  "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "work_schedule_tenant_id_name_key" ON "work_schedule"("tenant_id", "name");
ALTER TABLE "employee" ADD CONSTRAINT "employee_schedule_fk" FOREIGN KEY ("schedule_id") REFERENCES "work_schedule"("id") ON DELETE SET NULL;

CREATE TABLE "clock_place" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "name" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "radius_m" INTEGER NOT NULL DEFAULT 150,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE "clock_record" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "employee_id" TEXT NOT NULL REFERENCES "employee"("id"),
  "nsr" INTEGER NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  "hash" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION, "longitude" DOUBLE PRECISION, "accuracy_m" INTEGER,
  "place_id" TEXT, "outside" BOOLEAN,
  "photo" BYTEA,
  "source" TEXT NOT NULL CHECK ("source" IN ('proprio','loja')),
  "ip" TEXT, "device" TEXT, "user_id" TEXT
);
CREATE UNIQUE INDEX "clock_record_tenant_id_nsr_key" ON "clock_record"("tenant_id", "nsr");
CREATE INDEX "clock_record_employee_id_at_idx" ON "clock_record"("employee_id", "at");
-- A batida original nunca muda: correções são ajustes à parte, com motivo.
CREATE OR REPLACE FUNCTION clock_record_imutavel() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Batida de ponto não pode ser alterada nem apagada'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER clock_record_imutavel BEFORE UPDATE OR DELETE ON "clock_record" FOR EACH ROW EXECUTE FUNCTION clock_record_imutavel();

CREATE TABLE "clock_sequence" (
  "tenant_id" TEXT NOT NULL PRIMARY KEY REFERENCES "tenant"("id"),
  "last_nsr" INTEGER NOT NULL DEFAULT 0,
  "last_hash" TEXT NOT NULL DEFAULT ''
);
CREATE TABLE "clock_adjustment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "employee_id" TEXT NOT NULL REFERENCES "employee"("id"),
  "type" TEXT NOT NULL CHECK ("type" IN ('inclusao','desconsiderar')),
  "record_id" TEXT REFERENCES "clock_record"("id"),
  "at" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "clock_adjustment_employee_id_idx" ON "clock_adjustment"("employee_id");
CREATE TABLE "clock_occurrence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "employee_id" TEXT NOT NULL REFERENCES "employee"("id"),
  "type" TEXT NOT NULL,
  "from" DATE NOT NULL, "to" DATE NOT NULL,
  "note" TEXT,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "clock_occurrence_employee_id_from_idx" ON "clock_occurrence"("employee_id", "from");
CREATE TABLE "clock_closing" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "employee_id" TEXT NOT NULL REFERENCES "employee"("id"),
  "month" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_by" TEXT NOT NULL,
  "ack_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "clock_closing_employee_id_month_key" ON "clock_closing"("employee_id", "month");
CREATE TABLE "holiday" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL
);
CREATE UNIQUE INDEX "holiday_tenant_id_date_key" ON "holiday"("tenant_id", "date");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chart_account','financial_account','account_entry','employee','work_schedule','clock_place','clock_record','clock_sequence','clock_adjustment','clock_occurrence','clock_closing','holiday'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mercearia_app', t);
  END LOOP;
END $$;

-- Gerente passa a cuidar de funcionários e ponto.
UPDATE "role" SET "permissions" = array_append("permissions", 'hr.manage')
 WHERE "code" = 'store_manager' AND NOT ('hr.manage' = ANY("permissions"));
