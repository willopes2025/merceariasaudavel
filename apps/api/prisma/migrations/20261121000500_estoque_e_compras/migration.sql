-- Inteligência de estoque: fornecedores, pedido de compra, múltiplo de compra do produto.

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "pack_size" DECIMAL(14,3) NOT NULL DEFAULT 1,
ADD COLUMN     "supplier_id" TEXT;

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "contact_name" TEXT,
    "lead_time_days" INTEGER NOT NULL DEFAULT 7,
    "min_order" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "items" JSONB NOT NULL,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "expected_on" DATE,
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_tenant_id_active_name_idx" ON "supplier"("tenant_id", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tenant_id_document_key" ON "supplier"("tenant_id", "document");

-- CreateIndex
CREATE INDEX "purchase_order_tenant_id_status_idx" ON "purchase_order"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_tenant_id_supplier_id_idx" ON "purchase_order"("tenant_id", "supplier_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier', 'purchase_order'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ((SELECT app_tenant_visible(tenant_id::text)))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mercearia_app', t);
  END LOOP;
END $$;

-- Fornecedores que já vieram nas notas de entrada viram cadastro.
INSERT INTO supplier (id, tenant_id, name, document, created_at, updated_at)
SELECT gen_random_uuid()::text, e.tenant_id, MAX(e.supplier_name), e.supplier_document, now(), now()
  FROM stock_entry e WHERE e.supplier_document <> ''
 GROUP BY e.tenant_id, e.supplier_document
ON CONFLICT DO NOTHING;

ALTER TABLE supplier ADD CONSTRAINT supplier_values_check CHECK (lead_time_days BETWEEN 0 AND 120 AND min_order >= 0);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_status_check CHECK (status IN ('rascunho', 'enviado', 'recebido', 'cancelado'));
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_total_check CHECK (total >= 0);
ALTER TABLE product ADD CONSTRAINT product_pack_size_check CHECK (pack_size > 0);
