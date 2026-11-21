-- Entrega: bairros atendidos, endereços da cliente, entregadores e campos de entrega no pedido e na venda.

-- AlterTable
ALTER TABLE "tenant_setting" ADD COLUMN     "delivery_city" TEXT,
ADD COLUMN     "delivery_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "address" JSONB,
ADD COLUMN     "courier_id" TEXT,
ADD COLUMN     "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "dispatched_at" TIMESTAMP(3),
ADD COLUMN     "fulfillment" TEXT NOT NULL DEFAULT 'retirada',
ADD COLUMN     "payment_note" TEXT,
ADD COLUMN     "zone_id" TEXT;

-- CreateTable
CREATE TABLE "delivery_zone" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_order" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "free_above" DECIMAL(12,2),
    "eta_minutes" INTEGER NOT NULL DEFAULT 45,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_address" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "zone_id" TEXT NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zone_tenant_id_name_key" ON "delivery_zone"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "customer_address_tenant_id_customer_id_idx" ON "customer_address"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_token_key" ON "courier"("token");

-- CreateIndex
CREATE INDEX "courier_tenant_id_active_idx" ON "courier"("tenant_id", "active");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "courier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_zone', 'customer_address', 'courier'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ((SELECT app_tenant_visible(tenant_id::text)))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mercearia_app', t);
  END LOOP;
END $$;
GRANT DELETE ON customer_address TO mercearia_app;

-- Pedido ganha a etapa "saiu para entrega".
ALTER TABLE "order" DROP CONSTRAINT order_status_check;
ALTER TABLE "order" ADD CONSTRAINT order_status_check CHECK (status IN ('aguardando_pagamento', 'na_fila', 'preparando', 'pronto', 'saiu_entrega', 'entregue', 'cancelado'));
ALTER TABLE "order" ADD CONSTRAINT order_fulfillment_check CHECK (fulfillment IN ('retirada', 'entrega'));
ALTER TABLE "order" ADD CONSTRAINT order_delivery_check CHECK (fulfillment = 'retirada' OR (address IS NOT NULL AND zone_id IS NOT NULL));
ALTER TABLE "order" ADD CONSTRAINT order_delivery_fee_check CHECK (delivery_fee >= 0);
ALTER TABLE sale ADD CONSTRAINT sale_delivery_fee_check CHECK (delivery_fee >= 0);
ALTER TABLE delivery_zone ADD CONSTRAINT delivery_zone_values_check CHECK (fee >= 0 AND min_order >= 0 AND (free_above IS NULL OR free_above >= 0) AND eta_minutes BETWEEN 5 AND 600);
