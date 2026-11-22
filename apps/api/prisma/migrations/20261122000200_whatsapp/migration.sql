-- WhatsApp: atendimento (conversas e mensagens), agente de IA e carrinho por link.
ALTER TABLE "tenant_setting" ADD COLUMN IF NOT EXISTS "whatsapp_config" JSONB;

CREATE TABLE "wa_conversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "phone" TEXT NOT NULL,
  "name" TEXT,
  "customer_id" TEXT REFERENCES "customer"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'aberta' CHECK ("status" IN ('aberta', 'resolvida')),
  "assigned_to" TEXT REFERENCES "app_user"("id") ON DELETE SET NULL,
  "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
  "ai_replies" INTEGER NOT NULL DEFAULT 0,
  "needs_human" BOOLEAN NOT NULL DEFAULT false,
  "unread" INTEGER NOT NULL DEFAULT 0,
  "last_inbound_at" TIMESTAMP(3),
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_preview" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "wa_conversation_tenant_id_phone_key" ON "wa_conversation"("tenant_id", "phone");
CREATE INDEX "wa_conversation_tenant_id_last_message_at_idx" ON "wa_conversation"("tenant_id", "last_message_at");

CREATE TABLE "wa_message" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "conversation_id" TEXT NOT NULL REFERENCES "wa_conversation"("id") ON DELETE CASCADE,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('in', 'out')),
  "author" TEXT NOT NULL CHECK ("author" IN ('cliente', 'equipe', 'ia', 'sistema')),
  "user_id" TEXT,
  "text" TEXT NOT NULL,
  "media" TEXT,
  "external_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('recebida', 'enviada', 'falhou')),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "wa_message_tenant_id_external_id_key" ON "wa_message"("tenant_id", "external_id");
CREATE INDEX "wa_message_conversation_id_created_at_idx" ON "wa_message"("conversation_id", "created_at");

CREATE TABLE "wa_cart" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenant"("id"),
  "conversation_id" TEXT REFERENCES "wa_conversation"("id") ON DELETE SET NULL,
  "items" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "wa_cart_tenant_id_idx" ON "wa_cart"("tenant_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wa_conversation','wa_message','wa_cart'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mercearia_app', t);
  END LOOP;
END $$;
