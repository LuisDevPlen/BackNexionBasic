-- Nexion — esquema PostgreSQL
CREATE TABLE IF NOT EXISTS usuario (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  papel VARCHAR(50) NOT NULL DEFAULT 'cliente',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT usuario_papel_chk CHECK (papel IN ('admin', 'cliente'))
);

CREATE TABLE IF NOT EXISTS produto (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  preco NUMERIC(12,2) NOT NULL,
  descricao TEXT,
  categoria VARCHAR(100),
  imagem_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carrinho (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  produto_id INT NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  quantidade INT NOT NULL DEFAULT 1,
  CONSTRAINT carrinho_quantidade_chk CHECK (quantidade > 0),
  UNIQUE (usuario_id, produto_id)
);

CREATE TABLE IF NOT EXISTS pedido (
  id SERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pendente',
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pedido_status_chk CHECK (status IN ('pendente', 'aprovado', 'rejeitado'))
);

CREATE TABLE IF NOT EXISTS pedido_item (
  id SERIAL PRIMARY KEY,
  pedido_id INT NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  produto_id INT NOT NULL REFERENCES produto(id),
  quantidade INT NOT NULL,
  preco_unitario NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_carrinho_usuario ON carrinho(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pedido_usuario ON pedido(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pedido_item_pedido ON pedido_item(pedido_id);

-- Categorias e adicionais (compatível com produto.categoria texto legado)
CREATE TABLE IF NOT EXISTS categoria (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adicional (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  preco NUMERIC(12,2) NOT NULL DEFAULT 0,
  descricao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE produto ADD COLUMN IF NOT EXISTS categoria_id INT REFERENCES categoria(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS produto_adicional (
  produto_id INT NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  adicional_id INT NOT NULL REFERENCES adicional(id) ON DELETE CASCADE,
  ordem SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (produto_id, adicional_id)
);

CREATE INDEX IF NOT EXISTS idx_produto_categoria ON produto(categoria_id);
CREATE INDEX IF NOT EXISTS idx_produto_adicional_produto ON produto_adicional(produto_id);

-- Migra dados do texto categoria para categoria_id (idempotente)
INSERT INTO categoria (nome)
SELECT DISTINCT TRIM(categoria)
FROM produto
WHERE categoria IS NOT NULL AND TRIM(categoria) <> ''
ON CONFLICT (nome) DO NOTHING;

UPDATE produto p
SET categoria_id = c.id
FROM categoria c
WHERE TRIM(p.categoria) = c.nome AND p.categoria IS NOT NULL AND TRIM(p.categoria) <> '';

UPDATE produto p
SET categoria = cat.nome
FROM categoria cat
WHERE p.categoria_id = cat.id AND (p.categoria IS DISTINCT FROM cat.nome);

-- Carrinho: linha distinta por produto + combinação de extras (quantidade por adicional / unidade)
ALTER TABLE carrinho DROP CONSTRAINT IF EXISTS carrinho_usuario_id_produto_id_key;

ALTER TABLE pedido_item ADD COLUMN IF NOT EXISTS extras_unitario NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE carrinho ADD COLUMN IF NOT EXISTS adicional_quantidades JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE pedido_item ADD COLUMN IF NOT EXISTS adicional_quantidades JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'carrinho' AND column_name = 'opcao_adicionais'
  ) THEN
    UPDATE carrinho c
    SET adicional_quantidades = COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('adicional_id', trim(x)::int, 'quantidade', 1)
          ORDER BY trim(x)::int
        )
        FROM unnest(regexp_split_to_array(NULLIF(trim(c.opcao_adicionais), ''), ',')) AS x
        WHERE trim(x) <> '' AND trim(x) ~ '^[0-9]+$'
      ),
      '[]'::jsonb
    )
    WHERE trim(COALESCE(c.opcao_adicionais, '')) <> '';

    DROP INDEX IF EXISTS idx_carrinho_linha_usuario_produto_opcao;
    ALTER TABLE carrinho DROP COLUMN opcao_adicionais;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pedido_item' AND column_name = 'opcao_adicionais'
  ) THEN
    UPDATE pedido_item pi
    SET adicional_quantidades = COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object('adicional_id', trim(x)::int, 'quantidade', 1)
          ORDER BY trim(x)::int
        )
        FROM unnest(regexp_split_to_array(NULLIF(trim(pi.opcao_adicionais), ''), ',')) AS x
        WHERE trim(x) <> '' AND trim(x) ~ '^[0-9]+$'
      ),
      '[]'::jsonb
    )
    WHERE trim(COALESCE(pi.opcao_adicionais, '')) <> '';

    ALTER TABLE pedido_item DROP COLUMN opcao_adicionais;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_carrinho_linha_usuario_produto_opcao;
CREATE UNIQUE INDEX IF NOT EXISTS idx_carrinho_linha_usuario_produto_adq
  ON carrinho (usuario_id, produto_id, (md5(adicional_quantidades::text)));

-- Endereço de entrega no perfil do cliente (editável); cópia em cada pedido
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS endereco_entrega TEXT;

ALTER TABLE pedido ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(20);
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS endereco_entrega TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedido_forma_pagamento_chk'
  ) THEN
    ALTER TABLE pedido ADD CONSTRAINT pedido_forma_pagamento_chk
      CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('dinheiro', 'cartao', 'pix'));
  END IF;
END $$;
