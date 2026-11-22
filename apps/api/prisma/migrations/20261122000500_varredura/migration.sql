-- Varredura: a tabela de uso de IA era a única com empresa e sem isolamento por linha.
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ai_usage";
CREATE POLICY tenant_isolation ON "ai_usage"
  USING (tenant_id IS NULL OR (SELECT app_tenant_visible(tenant_id::text)))
  WITH CHECK (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true));
