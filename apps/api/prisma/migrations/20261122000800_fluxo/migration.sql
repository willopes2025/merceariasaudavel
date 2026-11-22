-- Fluxo de pessoas na loja (contagem das câmeras ou digitada), por hora, para medir a conversão do balcão.
CREATE TABLE "foot_traffic" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "store_id" TEXT NOT NULL REFERENCES "store"("id") ON DELETE CASCADE,
  "day" DATE NOT NULL,
  "hour" INTEGER NOT NULL CHECK ("hour" BETWEEN 0 AND 23),
  "entries" INTEGER NOT NULL DEFAULT 0 CHECK ("entries" >= 0),
  "exits" INTEGER NOT NULL DEFAULT 0 CHECK ("exits" >= 0),
  "source" TEXT NOT NULL DEFAULT 'manual' CHECK ("source" IN ('camera','manual')),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "foot_traffic_store_id_day_hour_key" ON "foot_traffic"("store_id", "day", "hour");
CREATE INDEX "foot_traffic_tenant_id_day_idx" ON "foot_traffic"("tenant_id", "day");
ALTER TABLE "foot_traffic" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "foot_traffic";
CREATE POLICY tenant_isolation ON "foot_traffic" USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "foot_traffic" TO mercearia_app;
