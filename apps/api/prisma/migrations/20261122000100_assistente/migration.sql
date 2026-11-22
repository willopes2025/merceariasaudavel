-- Assistente da equipe (orquestrador por texto e voz), portado da Plataforma Aritana.

ALTER TABLE "tenant_setting" ADD COLUMN "assistant_config" JSONB;

CREATE TABLE "assistant_session" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Nova conversa', "busy" BOOLEAN NOT NULL DEFAULT false,
    "approval" TEXT NOT NULL DEFAULT 'perguntar',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "assistant_session_tenant_id_user_id_updated_at_idx" ON "assistant_session"("tenant_id", "user_id", "updated_at");

CREATE TABLE "assistant_message" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL, "content" JSONB NOT NULL, "text" TEXT, "speech" TEXT, "origin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "assistant_message_session_id_created_at_idx" ON "assistant_message"("session_id", "created_at");
ALTER TABLE "assistant_message" ADD CONSTRAINT "assistant_message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assistant_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "assistant_action" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "session_id" TEXT NOT NULL, "user_id" TEXT,
    "tool" TEXT NOT NULL, "input" JSONB NOT NULL, "risk" TEXT NOT NULL, "status" TEXT NOT NULL,
    "summary" TEXT, "preview" JSONB, "result" JSONB, "error" TEXT, "progress" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finished_at" TIMESTAMP(3),
    CONSTRAINT "assistant_action_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "assistant_action_session_id_created_at_idx" ON "assistant_action"("session_id", "created_at");
ALTER TABLE "assistant_action" ADD CONSTRAINT "assistant_action_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assistant_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "assistant_request" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "number" INTEGER NOT NULL, "session_id" TEXT, "user_id" TEXT,
    "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "spec" TEXT NOT NULL, "plan" JSONB NOT NULL DEFAULT '[]',
    "module" TEXT, "priority" TEXT NOT NULL DEFAULT 'normal', "status" TEXT NOT NULL DEFAULT 'novo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_request_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assistant_request_tenant_id_number_key" ON "assistant_request"("tenant_id", "number");

CREATE TABLE "assistant_routine" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL, "instruction" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'horario',
    "time" TEXT NOT NULL DEFAULT '08:00', "interval_min" INTEGER, "window_start" TEXT, "window_end" TEXT,
    "days" JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]', "emails" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true, "approval" TEXT NOT NULL DEFAULT 'perguntar',
    "next_at" TIMESTAMP(3) NOT NULL, "last_at" TIMESTAMP(3), "last_session_id" TEXT, "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_routine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "assistant_routine_active_next_at_idx" ON "assistant_routine"("active", "next_at");

CREATE TABLE "assistant_attachment" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL, "mime" TEXT NOT NULL, "size" INTEGER NOT NULL, "data" BYTEA NOT NULL, "extract" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_attachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "assistant_attachment_tenant_id_user_id_idx" ON "assistant_attachment"("tenant_id", "user_id");

CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL, "tenant_id" TEXT, "user_id" TEXT, "feature" TEXT NOT NULL, "model" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0, "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_usage_tenant_id_created_at_idx" ON "ai_usage"("tenant_id", "created_at");

ALTER TABLE assistant_action ADD CONSTRAINT assistant_action_status_check CHECK (status IN ('concluida', 'aguardando', 'executando', 'cancelada', 'erro'));
ALTER TABLE assistant_session ADD CONSTRAINT assistant_session_approval_check CHECK (approval IN ('perguntar', 'automatico'));
ALTER TABLE assistant_routine ADD CONSTRAINT assistant_routine_approval_check CHECK (approval IN ('perguntar', 'automatico'));

-- Isolamento por organização (RLS), como nas outras tabelas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_session','assistant_message','assistant_action','assistant_request','assistant_routine','assistant_attachment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ((SELECT app_tenant_visible(tenant_id::text))) WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mercearia_app', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON ai_usage TO mercearia_app;

-- Gerentes passam a usar o Assistente (os papéis padrão foram gravados antes da permissão existir).
UPDATE "role" SET "permissions" = array_append("permissions", 'assistant.use')
 WHERE "code" = 'store_manager' AND NOT ('assistant.use' = ANY("permissions"));
