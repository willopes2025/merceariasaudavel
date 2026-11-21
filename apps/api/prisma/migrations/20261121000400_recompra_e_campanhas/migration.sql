-- Recompra (duração do produto, contatos) e campanhas (cupom, cashback turbinado, oferta).

-- AlterTable
ALTER TABLE "tenant_setting" ADD COLUMN     "msg_birthday" TEXT,
ADD COLUMN     "msg_lapsed" TEXT,
ADD COLUMN     "msg_repurchase" TEXT;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "repurchase_days" INTEGER;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "campaign_cashback" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "coupon_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "coupon_id" TEXT,
ADD COLUMN     "promo_savings" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_item" ADD COLUMN     "campaign_id" TEXT,
ADD COLUMN     "promo_savings" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "campaign" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "audience" TEXT NOT NULL DEFAULT 'todos',
    "description" TEXT,
    "code" TEXT,
    "discount_pct" DECIMAL(5,2),
    "discount_amount" DECIMAL(12,2),
    "min_purchase" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_uses" INTEGER,
    "max_per_customer" INTEGER,
    "extra_cashback_pct" DECIMAL(5,2),
    "scope" TEXT NOT NULL DEFAULT 'tudo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "product_id" TEXT,
    "category_id" TEXT,
    "promo_price" DECIMAL(12,2),

    CONSTRAINT "campaign_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contact" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "product_id" TEXT,
    "kind" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_tenant_id_active_type_idx" ON "campaign"("tenant_id", "active", "type");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_tenant_id_code_key" ON "campaign"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "campaign_item_tenant_id_campaign_id_idx" ON "campaign_item"("tenant_id", "campaign_id");

-- CreateIndex
CREATE INDEX "campaign_item_tenant_id_product_id_idx" ON "campaign_item"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "customer_contact_tenant_id_customer_id_kind_created_at_idx" ON "customer_contact"("tenant_id", "customer_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_item" ADD CONSTRAINT "campaign_item_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contact" ADD CONSTRAINT "customer_contact_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign', 'campaign_item', 'customer_contact'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ((SELECT app_tenant_visible(tenant_id::text)))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO mercearia_app', t);
  END LOOP;
END $$;
-- Campanha se desliga (não se apaga: as vendas apontam para ela). Itens da campanha se regravam.
GRANT UPDATE ON campaign TO mercearia_app;
GRANT UPDATE, DELETE ON campaign_item TO mercearia_app;
-- Registro de contato: só inserção.

ALTER TABLE campaign ADD CONSTRAINT campaign_type_check CHECK (type IN ('cupom', 'cashback', 'oferta'));
ALTER TABLE campaign ADD CONSTRAINT campaign_audience_check CHECK (audience IN ('todos', 'membros', 'aniversariantes'));
ALTER TABLE campaign ADD CONSTRAINT campaign_scope_check CHECK (scope IN ('tudo', 'categorias', 'produtos'));
ALTER TABLE campaign ADD CONSTRAINT campaign_period_check CHECK (ends_on >= starts_on);
ALTER TABLE campaign ADD CONSTRAINT campaign_coupon_check CHECK (type <> 'cupom' OR (code IS NOT NULL AND (discount_pct IS NOT NULL) <> (discount_amount IS NOT NULL)));
ALTER TABLE campaign ADD CONSTRAINT campaign_values_check CHECK (
  (discount_pct IS NULL OR (discount_pct > 0 AND discount_pct <= 100)) AND
  (discount_amount IS NULL OR discount_amount > 0) AND min_purchase >= 0 AND
  (extra_cashback_pct IS NULL OR (extra_cashback_pct > 0 AND extra_cashback_pct <= 100)) AND
  (max_uses IS NULL OR max_uses > 0) AND (max_per_customer IS NULL OR max_per_customer > 0));
ALTER TABLE campaign_item ADD CONSTRAINT campaign_item_target_check CHECK ((product_id IS NULL) <> (category_id IS NULL) AND (promo_price IS NULL OR promo_price >= 0));
ALTER TABLE customer_contact ADD CONSTRAINT customer_contact_kind_check CHECK (kind IN ('recompra', 'sumida', 'aniversario'));
ALTER TABLE product ADD CONSTRAINT product_repurchase_days_check CHECK (repurchase_days IS NULL OR repurchase_days BETWEEN 1 AND 365);
ALTER TABLE sale ADD CONSTRAINT sale_campaign_money_check CHECK (coupon_discount >= 0 AND promo_savings >= 0 AND campaign_cashback >= 0 AND coupon_discount <= discount);
