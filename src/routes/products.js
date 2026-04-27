import { Router } from 'express';
import { pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

/** Sem GROUP BY: compatível com qualquer PostgreSQL e evita erro com JOIN em categoria */
const produtoSelectBase = `
SELECT p.id, p.nome, p.preco, p.descricao, p.categoria, p.categoria_id, p.imagem_url, p.created_at,
       COALESCE(cat.nome, p.categoria) AS categoria_nome,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', a.id,
               'nome', a.nome,
               'preco', a.preco,
               'descricao', a.descricao
             ) ORDER BY pa.ordem NULLS LAST, a.nome
           )
           FROM produto_adicional pa
           INNER JOIN adicional a ON a.id = pa.adicional_id
           WHERE pa.produto_id = p.id
         ),
         '[]'::json
       ) AS adicionais
FROM produto p
LEFT JOIN categoria cat ON cat.id = p.categoria_id
`;

async function fetchProdutoCompleto(q, id) {
  const { rows } = await q.query(`${produtoSelectBase} WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}

async function resolveCategoria(client, { categoria_id, categoria }) {
  const idRaw = categoria_id;
  const strRaw = categoria != null ? String(categoria).trim() : '';

  if (idRaw != null && idRaw !== '') {
    const id = parseInt(String(idRaw), 10);
    if (!Number.isFinite(id)) {
      return { error: 'categoria_id inválido' };
    }
    const { rows } = await client.query('SELECT id, nome FROM categoria WHERE id = $1', [id]);
    if (!rows[0]) {
      return { error: 'Categoria não encontrada' };
    }
    return { categoria_id: id, categoriaNome: rows[0].nome };
  }

  if (strRaw) {
    let ins = await client.query(
      `INSERT INTO categoria (nome) VALUES ($1)
       ON CONFLICT (nome) DO NOTHING
       RETURNING id, nome`,
      [strRaw]
    );
    let row = ins.rows[0];
    if (!row) {
      const sel = await client.query('SELECT id, nome FROM categoria WHERE nome = $1', [strRaw]);
      row = sel.rows[0];
    }
    return { categoria_id: row.id, categoriaNome: row.nome };
  }

  return { categoria_id: null, categoriaNome: null };
}

async function replaceProdutoAdicionais(client, produtoId, adicional_ids) {
  await client.query('DELETE FROM produto_adicional WHERE produto_id = $1', [produtoId]);
  if (!Array.isArray(adicional_ids) || adicional_ids.length === 0) return;
  const ids = [
    ...new Set(
      adicional_ids
        .map((x) => parseInt(String(x), 10))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (!ids.length) return;
  const { rows: exist } = await client.query(`SELECT id FROM adicional WHERE id = ANY($1::int[])`, [
    ids,
  ]);
  const ok = new Set(exist.map((r) => r.id));
  let ordem = 0;
  for (const aid of ids) {
    if (!ok.has(aid)) continue;
    await client.query(
      `INSERT INTO produto_adicional (produto_id, adicional_id, ordem) VALUES ($1, $2, $3)
       ON CONFLICT (produto_id, adicional_id) DO UPDATE SET ordem = EXCLUDED.ordem`,
      [produtoId, aid, ordem++]
    );
  }
}

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`${produtoSelectBase} ORDER BY p.id`);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao listar produtos' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = await fetchProdutoCompleto(pool, req.params.id);
    if (!row) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { nome, preco } = req.body;
  if (!nome || preco == null) {
    return res.status(400).json({ error: 'nome e preco são obrigatórios' });
  }
  const client = await pool.connect();
  try {
    const { descricao, imagem_url, adicional_ids } = req.body;
    await client.query('BEGIN');
    const resolved = await resolveCategoria(client, req.body);
    if (resolved.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: resolved.error });
    }
    const { rows } = await client.query(
      `INSERT INTO produto (nome, preco, descricao, categoria, categoria_id, imagem_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [nome, preco, descricao ?? null, resolved.categoriaNome, resolved.categoria_id, imagem_url ?? null]
    );
    const id = rows[0].id;
    await replaceProdutoAdicionais(client, id, adicional_ids);
    await client.query('COMMIT');
    const full = await fetchProdutoCompleto(pool, id);
    res.status(201).json(full);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Erro ao criar produto' });
  } finally {
    client.release();
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM produto WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    const prev = cur.rows[0];

    let resolved;
    if (
      Object.prototype.hasOwnProperty.call(req.body, 'categoria_id') &&
      req.body.categoria_id == null
    ) {
      resolved = { categoria_id: null, categoriaNome: null };
    } else {
      resolved = await resolveCategoria(client, {
        categoria_id: Object.prototype.hasOwnProperty.call(req.body, 'categoria_id')
          ? req.body.categoria_id
          : prev.categoria_id,
        categoria: Object.prototype.hasOwnProperty.call(req.body, 'categoria')
          ? req.body.categoria
          : prev.categoria,
      });
    }
    if (resolved.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: resolved.error });
    }

    const nome = req.body.nome ?? prev.nome;
    const preco = req.body.preco != null ? req.body.preco : prev.preco;
    const descricao = Object.prototype.hasOwnProperty.call(req.body, 'descricao')
      ? req.body.descricao
      : prev.descricao;
    const imagem_url = Object.prototype.hasOwnProperty.call(req.body, 'imagem_url')
      ? req.body.imagem_url
      : prev.imagem_url;

    await client.query(
      `UPDATE produto SET
        nome = $1,
        preco = $2,
        descricao = $3,
        categoria = $4,
        categoria_id = $5,
        imagem_url = $6
       WHERE id = $7`,
      [
        nome,
        preco,
        descricao,
        resolved.categoriaNome,
        resolved.categoria_id,
        imagem_url,
        req.params.id,
      ]
    );

    if (Object.prototype.hasOwnProperty.call(req.body, 'adicional_ids')) {
      await replaceProdutoAdicionais(client, Number(req.params.id), req.body.adicional_ids);
    }

    await client.query('COMMIT');
    const full = await fetchProdutoCompleto(pool, req.params.id);
    res.json(full);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM produto WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Produto não encontrado' });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao remover produto' });
  }
});

export default router;
