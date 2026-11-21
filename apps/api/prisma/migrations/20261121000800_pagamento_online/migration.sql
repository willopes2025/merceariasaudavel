-- Pagamento online (Pix e cartão no app, Pix no totem) pelo Mercado Pago.

ALTER TABLE "tenant_setting" ADD COLUMN "online_pix" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "online_card" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "online_totem" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order" ADD COLUMN "pay_online" TEXT;

CREATE TABLE "online_payment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "provider_ref" TEXT,
    "provider_payment_id" TEXT,
    "qr_code" TEXT,
    "qr_image" TEXT,
    "checkout_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "sale_id" TEXT,
    "settle_error" TEXT,
    "last_check_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "online_payment_tenant_id_order_id_idx" ON "online_payment"("tenant_id", "order_id");
CREATE INDEX "online_payment_status_paid_at_idx" ON "online_payment"("status", "paid_at");
-- Um pagamento aprovado no provedor vale para um registro só.
CREATE UNIQUE INDEX "online_payment_provider_payment_key" ON "online_payment"("provider", "provider_payment_id");

ALTER TABLE "online_payment" ADD CONSTRAINT "online_payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE online_payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON online_payment;
CREATE POLICY tenant_isolation ON online_payment
  USING ((SELECT app_tenant_visible(tenant_id::text)))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE ON online_payment TO mercearia_app;

ALTER TABLE online_payment ADD CONSTRAINT online_payment_method_check CHECK (method IN ('pix', 'cartao'));
ALTER TABLE online_payment ADD CONSTRAINT online_payment_status_check CHECK (status IN ('pendente', 'pago', 'cancelado', 'expirado', 'estornado', 'divergente'));
ALTER TABLE online_payment ADD CONSTRAINT online_payment_amount_check CHECK (amount > 0);
ALTER TABLE "order" ADD CONSTRAINT order_pay_online_check CHECK (pay_online IS NULL OR pay_online IN ('pix', 'cartao'));
