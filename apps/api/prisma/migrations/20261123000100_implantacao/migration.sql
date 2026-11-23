-- Pendências de implantação: o que a loja ainda precisa enviar ou configurar, marcado um a um.
CREATE TABLE "setup_item" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pendente' CHECK ("status" IN ('pendente','recebido','concluido','nao_se_aplica')),
  "note" TEXT,
  "updated_by_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "setup_item_tenant_id_key_key" ON "setup_item"("tenant_id", "key");
ALTER TABLE "setup_item" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "setup_item";
CREATE POLICY tenant_isolation ON "setup_item" USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "setup_item" TO mercearia_app;
