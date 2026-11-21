-- Fase 2b: montagem do produto (complementos), pedidos do app/totem/balcão e tela de preparo.

-- AlterTable
ALTER TABLE "tenant_setting" ADD COLUMN     "kitchen_from_counter" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "orders_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "sale_item" ADD COLUMN     "options" JSONB;

-- CreateTable
CREATE TABLE "option_group" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "supply_id" TEXT,
    "supply_qty" DECIMAL(14,3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aguardando_pagamento',
    "customer_id" TEXT,
    "call_name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "estimate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sale_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "option_group_tenant_id_product_id_idx" ON "option_group"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "product_option_tenant_id_group_id_idx" ON "product_option"("tenant_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_sale_id_key" ON "order"("sale_id");

-- CreateIndex
CREATE INDEX "order_tenant_id_store_id_status_idx" ON "order"("tenant_id", "store_id", "status");

-- CreateIndex
CREATE INDEX "order_tenant_id_customer_id_created_at_idx" ON "order"("tenant_id", "customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "option_group" ADD CONSTRAINT "option_group_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "option_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option" ADD CONSTRAINT "product_option_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Isolamento por organização, igual às outras tabelas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['option_group', 'product_option', 'order'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ((SELECT app_tenant_visible(tenant_id::text)))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mercearia_app', t);
  END LOOP;
END $$;
-- Montagem pode ser apagada pela loja; pedido nunca (cancela).
GRANT DELETE ON option_group, product_option TO mercearia_app;

ALTER TABLE option_group ADD CONSTRAINT option_group_select_check CHECK (min_select >= 0 AND max_select >= 1 AND max_select >= min_select AND max_select <= 20);
ALTER TABLE product_option ADD CONSTRAINT product_option_price_check CHECK (price >= 0);
ALTER TABLE product_option ADD CONSTRAINT product_option_supply_check CHECK ((supply_id IS NULL AND supply_qty IS NULL) OR (supply_id IS NOT NULL AND supply_qty > 0));
ALTER TABLE "order" ADD CONSTRAINT order_channel_check CHECK (channel IN ('app', 'totem', 'balcao'));
ALTER TABLE "order" ADD CONSTRAINT order_status_check CHECK (status IN ('aguardando_pagamento', 'na_fila', 'preparando', 'pronto', 'entregue', 'cancelado'));
ALTER TABLE "order" ADD CONSTRAINT order_paid_check CHECK (status IN ('aguardando_pagamento', 'cancelado') OR sale_id IS NOT NULL);
