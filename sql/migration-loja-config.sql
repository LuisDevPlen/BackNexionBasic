-- Configuração da loja (uma única linha, id = 1)
-- Execute no Postgres (Neon, local, etc.) se a base já existir sem esta tabela.

CREATE TABLE IF NOT EXISTS loja_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  CONSTRAINT loja_config_singleton_chk CHECK (id = 1),
  imprimir_pedido_automatico BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO loja_config (id, imprimir_pedido_automatico)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;
