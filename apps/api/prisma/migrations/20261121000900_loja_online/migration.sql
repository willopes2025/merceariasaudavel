-- Loja online: vitrine pública, origem das vendas (UTM) e ids de anúncio.
ALTER TABLE "tenant_setting" ADD COLUMN "shop_description" TEXT,
ADD COLUMN "meta_pixel_id" TEXT,
ADD COLUMN "ga4_id" TEXT;
ALTER TABLE "customer" ADD COLUMN "origin" JSONB;
ALTER TABLE "order" ADD COLUMN "origin" JSONB;
CREATE INDEX "order_origin_source_idx" ON "order" ((origin->>'source')) WHERE origin IS NOT NULL;
ALTER TABLE tenant_setting ADD CONSTRAINT tenant_setting_ads_check CHECK ((meta_pixel_id IS NULL OR meta_pixel_id ~ '^\d{6,20}$') AND (ga4_id IS NULL OR ga4_id ~ '^G-[A-Z0-9]{4,15}$'));
