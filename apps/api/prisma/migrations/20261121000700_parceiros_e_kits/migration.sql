-- Parceiros (código, desconto, comissão, portal), comissão nas vendas, fechamento do mês e kits.

-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "partner_id" TEXT,
ADD COLUMN     "partner_since" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "partner_commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "partner_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "partner_id" TEXT;

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "coupon_code" TEXT;

-- CreateTable
CREATE TABLE "partner" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'nutricionista',
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "code" TEXT NOT NULL,
    "customer_discount_pct" DECIMAL(5,2),
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "token" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_payout" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sales" INTEGER NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payable_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "goal" TEXT,
    "partner_id" TEXT,
    "image_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kit_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kit_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_token_key" ON "partner"("token");

-- CreateIndex
CREATE UNIQUE INDEX "partner_tenant_id_code_key" ON "partner"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "partner_payout_tenant_id_month_idx" ON "partner_payout"("tenant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payout_partner_id_month_key" ON "partner_payout"("partner_id", "month");

-- CreateIndex
CREATE INDEX "kit_tenant_id_active_idx" ON "kit"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "kit_item_tenant_id_kit_id_idx" ON "kit_item"("tenant_id", "kit_id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payout" ADD CONSTRAINT "partner_payout_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit" ADD CONSTRAINT "kit_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kit_item" ADD CONSTRAINT "kit_item_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "kit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partner', 'partner_payout', 'kit', 'kit_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ((SELECT app_tenant_visible(tenant_id::text)))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mercearia_app', t);
  END LOOP;
END $$;
GRANT DELETE ON kit_item TO mercearia_app;
-- Fechamento do mês não se altera nem se apaga.
REVOKE UPDATE ON partner_payout FROM mercearia_app;

ALTER TABLE partner ADD CONSTRAINT partner_kind_check CHECK (kind IN ('nutricionista', 'personal', 'influenciador', 'outro'));
ALTER TABLE partner ADD CONSTRAINT partner_code_check CHECK (code ~ '^[A-Z0-9-]{3,20}$');
ALTER TABLE partner ADD CONSTRAINT partner_values_check CHECK (commission_pct BETWEEN 0 AND 100 AND (customer_discount_pct IS NULL OR (customer_discount_pct > 0 AND customer_discount_pct <= 100)));
ALTER TABLE partner_payout ADD CONSTRAINT partner_payout_month_check CHECK (month ~ '^\d{4}-\d{2}$' AND amount >= 0 AND revenue >= 0);
ALTER TABLE kit_item ADD CONSTRAINT kit_item_quantity_check CHECK (quantity > 0);
ALTER TABLE sale ADD CONSTRAINT sale_partner_money_check CHECK (partner_discount >= 0 AND partner_commission >= 0);
