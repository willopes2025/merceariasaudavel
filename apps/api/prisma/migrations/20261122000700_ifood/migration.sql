-- Pedidos do iFood: entram pela API, viram pedido na tela de preparo e venda no canal iFood.
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_channel_check;
ALTER TABLE "order" ADD CONSTRAINT order_channel_check CHECK (channel IN ('app', 'totem', 'balcao', 'ifood'));

CREATE TABLE "ifood_order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "store_id" TEXT NOT NULL REFERENCES "store"("id"),
  "ifood_id" TEXT NOT NULL,
  "display_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'importado' CHECK ("status" IN ('importado','sem_cadastro','cancelado','concluido')),
  "customer_name" TEXT NOT NULL DEFAULT '',
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "local_total" DECIMAL(12,2),
  "payload" JSONB NOT NULL,
  "order_id" TEXT REFERENCES "order"("id") ON DELETE SET NULL,
  "problem" TEXT,
  "synced_status" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ifood_order_ifood_id_key" ON "ifood_order"("ifood_id");
CREATE INDEX "ifood_order_tenant_id_created_at_idx" ON "ifood_order"("tenant_id", "created_at");
ALTER TABLE "ifood_order" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ifood_order";
CREATE POLICY tenant_isolation ON "ifood_order" USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "ifood_order" TO mercearia_app;
