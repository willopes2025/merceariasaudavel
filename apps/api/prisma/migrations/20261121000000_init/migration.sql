-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_setting" (
    "tenant_id" TEXT NOT NULL,
    "cashback_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cashback_days" INTEGER NOT NULL DEFAULT 0,
    "cashback_max_use_pct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_setting_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "store" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" CHAR(14),
    "phone" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stock_store_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "whatsapp" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "role_id" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_store" (
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,

    CONSTRAINT "user_store_pkey" PRIMARY KEY ("user_id","store_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_sequence" (
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_sequence_pkey" PRIMARY KEY ("tenant_id","name")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "birth_date" DATE,
    "phone" TEXT,
    "email" TEXT,
    "allow_whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "goal" TEXT,
    "is_member" BOOLEAN NOT NULL DEFAULT false,
    "member_since" TIMESTAMP(3),
    "member_source" TEXT,
    "cashback_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "store_id" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_entry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "sale_id" TEXT,
    "expires_at" DATE,
    "note" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashback_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_category" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'revenda',
    "category_id" TEXT,
    "brand" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "sold_by_weight" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "member_price" DECIMAL(12,2),
    "cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "track_lots" BOOLEAN NOT NULL DEFAULT false,
    "min_stock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "sellable" BOOLEAN NOT NULL DEFAULT true,
    "ncm" TEXT,
    "cest" TEXT,
    "supplier" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "recipe_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balance" (
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("product_id","store_id")
);

-- CreateTable
CREATE TABLE "stock_lot" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" DATE,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "lot_id" TEXT,
    "sale_id" TEXT,
    "count_id" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'insumos',
    "day" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "diff_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "payment_method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_session" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "opened_by_id" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_amount" DECIMAL(12,2) NOT NULL,
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "expected_cash" DECIMAL(12,2),
    "counted_amount" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "notes" TEXT,

    CONSTRAINT "cash_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movement" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method_id" TEXT,
    "sale_id" TEXT,
    "reverses_id" TEXT,
    "note" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "store_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "seller_id" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'loja',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "member_pricing" BOOLEAN NOT NULL DEFAULT false,
    "gross_total" DECIMAL(12,2) NOT NULL,
    "member_savings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "cashback_used" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cashback_earned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "items_count" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_at" TIMESTAMP(3),
    "canceled_by_id" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category_id" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "list_price" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'loja',
    "store_id" TEXT,
    "ref_id" TEXT,
    "period" TEXT NOT NULL DEFAULT 'mes',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "target" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tv_screen" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'equipe',
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tv_screen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "paid_date" DATE,
    "note" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_config" (
    "store_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_emit" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'homologacao',
    "token_homologacao" TEXT,
    "token_producao" TEXT,
    "cfop" TEXT NOT NULL DEFAULT '5102',
    "icms_origin" TEXT NOT NULL DEFAULT '0',
    "icms_cst" TEXT NOT NULL DEFAULT '102',
    "default_ncm" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_config_pkey" PRIMARY KEY ("store_id")
);

-- CreateTable
CREATE TABLE "fiscal_document" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'nfce',
    "ref" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "number" TEXT,
    "series" TEXT,
    "access_key" TEXT,
    "sefaz_status" TEXT,
    "message" TEXT,
    "xml_url" TEXT,
    "danfe_url" TEXT,
    "qrcode_url" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "customer_name" TEXT,
    "customer_document" TEXT,
    "payload" JSONB NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorized_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "canceled_by_id" TEXT,

    CONSTRAINT "fiscal_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "access_key" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "series" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_document" TEXT NOT NULL,
    "issued_at" DATE NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_product" (
    "tenant_id" TEXT NOT NULL,
    "supplier_document" TEXT NOT NULL,
    "supplier_code" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "supplier_product_pkey" PRIMARY KEY ("tenant_id","supplier_document","supplier_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_tenant_id_code_key" ON "store"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "app_user_tenant_id_idx" ON "app_user"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_tenant_id_email_key" ON "app_user"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_code_key" ON "role"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_entity_id_idx" ON "audit_log"("tenant_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "customer_tenant_id_phone_idx" ON "customer"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "customer_tenant_id_active_name_idx" ON "customer"("tenant_id", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_document_key" ON "customer"("tenant_id", "document");

-- CreateIndex
CREATE INDEX "cashback_entry_customer_id_created_at_idx" ON "cashback_entry"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_category_tenant_id_name_key" ON "product_category"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "product_tenant_id_active_name_idx" ON "product"("tenant_id", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenant_id_sku_key" ON "product"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenant_id_barcode_key" ON "product"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_item_product_id_ingredient_id_key" ON "recipe_item"("product_id", "ingredient_id");

-- CreateIndex
CREATE INDEX "stock_lot_tenant_id_expires_at_idx" ON "stock_lot"("tenant_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lot_product_id_store_id_code_key" ON "stock_lot"("product_id", "store_id", "code");

-- CreateIndex
CREATE INDEX "stock_movement_product_id_created_at_idx" ON "stock_movement"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_type_created_at_idx" ON "stock_movement"("tenant_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "stock_movement_sale_id_idx" ON "stock_movement"("sale_id");

-- CreateIndex
CREATE INDEX "inventory_count_tenant_id_store_id_day_idx" ON "inventory_count"("tenant_id", "store_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_tenant_id_name_key" ON "payment_method"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "cash_session_tenant_id_store_id_opened_at_idx" ON "cash_session"("tenant_id", "store_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movement_reverses_id_key" ON "cash_movement"("reverses_id");

-- CreateIndex
CREATE INDEX "cash_movement_session_id_idx" ON "cash_movement"("session_id");

-- CreateIndex
CREATE INDEX "cash_movement_sale_id_idx" ON "cash_movement"("sale_id");

-- CreateIndex
CREATE INDEX "sale_tenant_id_store_id_created_at_idx" ON "sale"("tenant_id", "store_id", "created_at");

-- CreateIndex
CREATE INDEX "sale_customer_id_idx" ON "sale"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_tenant_id_number_key" ON "sale"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sale_item_sale_id_idx" ON "sale_item"("sale_id");

-- CreateIndex
CREATE INDEX "sale_item_tenant_id_product_id_idx" ON "sale_item"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "goal_tenant_id_start_date_end_date_idx" ON "goal"("tenant_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "tv_screen_token_key" ON "tv_screen"("token");

-- CreateIndex
CREATE INDEX "payable_tenant_id_status_due_date_idx" ON "payable"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "fiscal_config_tenant_id_idx" ON "fiscal_config"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_document_ref_key" ON "fiscal_document"("ref");

-- CreateIndex
CREATE INDEX "fiscal_document_tenant_id_created_at_idx" ON "fiscal_document"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "fiscal_document_sale_id_idx" ON "fiscal_document"("sale_id");

-- CreateIndex
CREATE INDEX "stock_entry_tenant_id_created_at_idx" ON "stock_entry"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_entry_tenant_id_access_key_key" ON "stock_entry"("tenant_id", "access_key");

-- AddForeignKey
ALTER TABLE "tenant_setting" ADD CONSTRAINT "tenant_setting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_store" ADD CONSTRAINT "user_store_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_store" ADD CONSTRAINT "user_store_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_entry" ADD CONSTRAINT "cashback_entry_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_item" ADD CONSTRAINT "recipe_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_item" ADD CONSTRAINT "recipe_item_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_method_id_fkey" FOREIGN KEY ("method_id") REFERENCES "payment_method"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "cash_movement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tv_screen" ADD CONSTRAINT "tv_screen_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

