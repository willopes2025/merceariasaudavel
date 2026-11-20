-- Isolamento por organização no próprio banco (segunda camada de defesa),
-- no mesmo molde do Soul ERP e do VISIO.
--
-- A API já filtra por tenant_id vindo do token. Aqui o PostgreSQL passa a
-- garantir isso também: em toda requisição autenticada a conexão troca para a
-- role `mercearia_app` e informa as organizações visíveis em `app.tenant_ids`.
-- A role dona das tabelas (a do DATABASE_URL) ignora as políticas: é o que
-- permite migração, seed, login, a tela da TV e rotinas agendadas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mercearia_app') THEN
    CREATE ROLE mercearia_app NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT mercearia_app TO %I', current_user);
EXCEPTION WHEN others THEN NULL; -- superusuário já pode
END
$$;

GRANT USAGE ON SCHEMA public TO mercearia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mercearia_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mercearia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mercearia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mercearia_app;

CREATE OR REPLACE FUNCTION app_tenant_visible(tid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT tid = ANY (string_to_array(coalesce(current_setting('app.tenant_ids', true), ''), ','))
$$;

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attname = 'tenant_id' AND NOT a.attisdropped
      AND c.relname <> 'role'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING ((SELECT app_tenant_visible(tenant_id::text)))
         WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      target
    );
  END LOOP;
END
$$;

-- Papéis: os do sistema (tenant_id nulo) são lidos por todos.
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON role;
CREATE POLICY tenant_isolation ON role
  USING (tenant_id IS NULL OR (SELECT app_tenant_visible(tenant_id)))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
  USING ((SELECT app_tenant_visible(id)))
  WITH CHECK (id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------- regras

-- Histórico só acrescenta: nem a aplicação altera o passado.
REVOKE UPDATE, DELETE ON audit_log FROM mercearia_app;
REVOKE UPDATE, DELETE ON cash_movement FROM mercearia_app;
REVOKE UPDATE, DELETE ON stock_movement FROM mercearia_app;
REVOKE UPDATE, DELETE ON cashback_entry FROM mercearia_app;
REVOKE DELETE ON fiscal_document FROM mercearia_app;
REVOKE DELETE ON sale FROM mercearia_app;
REVOKE UPDATE, DELETE ON sale_item FROM mercearia_app;
REVOKE UPDATE, DELETE ON inventory_count FROM mercearia_app;

-- Um caixa aberto por loja de cada vez.
CREATE UNIQUE INDEX cash_session_one_open_per_store ON cash_session (store_id) WHERE status = 'open';

-- Lote não fica negativo (o que passar do lote sai "sem lote" e fica no saldo do produto).
ALTER TABLE stock_lot ADD CONSTRAINT stock_lot_quantity_check CHECK (quantity >= 0);
ALTER TABLE customer ADD CONSTRAINT customer_cashback_check CHECK (cashback_balance >= 0);
ALTER TABLE sale ADD CONSTRAINT sale_money_check CHECK (total >= 0 AND discount >= 0 AND cashback_used >= 0 AND cashback_earned >= 0);
ALTER TABLE recipe_item ADD CONSTRAINT recipe_item_quantity_check CHECK (quantity > 0 AND product_id <> ingredient_id);
