import { Router } from 'express';
import { pool, advisoryLockUsuario } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

/** Normaliza lista: ordena por adicional_id; quantidade 1–999 por tipo (0 = ignorado) */
function normalizarAdicionalItens(arr) {
  if (!Array.isArray(arr) || !arr.length) return [];
  const map = new Map();
  for (const row of arr) {
    const aid = parseInt(row.adicional_id ?? row.id, 10);
    const raw = parseInt(row.quantidade ?? row.qtd ?? 0, 10);
    const q = Math.min(999, Math.max(0, Number.isFinite(raw) ? raw : 0));
    if (!Number.isFinite(aid) || q <= 0) continue;
    map.set(aid, (map.get(aid) ?? 0) + q);
  }
  const out = [...map.entries()].map(([adicional_id, quantidade]) => ({ adicional_id, quantidade }));
  out.sort((a, b) => a.adicional_id - b.adicional_id);
  return out;
}

/** Body: adicional_itens [{adicional_id, quantidade}] OU adicional_ids [1,2] (legado, qtd 1) */
function extrairLinhasDoBody(body) {
  if (Array.isArray(body.adicional_itens) && body.adicional_itens.length) {
    return normalizarAdicionalItens(body.adicional_itens);
  }
  if (Array.isArray(body.adicional_ids) && body.adicional_ids.length) {
    return normalizarAdicionalItens(
      body.adicional_ids.map((id) => ({ adicional_id: id, quantidade: 1 }))
    );
  }
  return [];
}

async function validarLinhasNoProduto(q, produtoId, linhas) {
  if (!linhas.length) return [];
  const ids = linhas.map((l) => l.adicional_id);
  const { rows } = await q.query(
    `SELECT COUNT(DISTINCT pa.adicional_id)::int AS c
     FROM produto_adicional pa
     WHERE pa.produto_id = $1 AND pa.adicional_id = ANY($2::int[])`,
    [produtoId, ids]
  );
  if (rows[0].c !== ids.length) {
    const err = new Error('Um ou mais adicionais não pertencem a este produto');
    err.status = 400;
    throw err;
  }
  return linhas;
}

function parseLinhasDb(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const j = JSON.parse(val);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function somaExtrasUnitario(q, linhas) {
  if (!linhas.length) return 0;
  let sum = 0;
  for (const row of linhas) {
    const { rows } = await q.query('SELECT preco FROM adicional WHERE id = $1', [row.adicional_id]);
    if (rows[0]) sum += Number(rows[0].preco) * row.quantidade;
  }
  return sum;
}

async function montarItensCarrinho(rows) {
  const itens = [];
  for (const r of rows) {
    const linhas = normalizarAdicionalItens(parseLinhasDb(r.adicional_quantidades));
    const extras = await somaExtrasUnitario(pool, linhas);
    const base = Number(r.preco);
    let adicionais_selecionados = [];
    if (linhas.length) {
      const ids = linhas.map((l) => l.adicional_id);
      const ad = await pool.query(
        `SELECT id, nome, preco FROM adicional WHERE id = ANY($1::int[]) ORDER BY id`,
        [ids]
      );
      const precoPorId = Object.fromEntries(ad.rows.map((x) => [x.id, x]));
      adicionais_selecionados = linhas.map((l) => {
        const a = precoPorId[l.adicional_id];
        return {
          id: l.adicional_id,
          nome: a?.nome ?? `#${l.adicional_id}`,
          preco: a?.preco ?? 0,
          quantidade: l.quantidade,
        };
      });
    }
    itens.push({
      id: r.id,
      quantidade: r.quantidade,
      produto_id: r.produto_id,
      nome: r.nome,
      preco: base,
      descricao: r.descricao,
      categoria: r.categoria,
      imagem_url: r.imagem_url,
      adicional_quantidades: linhas,
      extras_unitario: extras,
      preco_unitario_total: base + extras,
      adicionais_selecionados,
    });
  }
  return itens;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.quantidade, c.produto_id, c.adicional_quantidades,
              p.nome, p.preco, p.descricao, p.categoria, p.imagem_url
       FROM carrinho c
       JOIN produto p ON p.id = c.produto_id
       WHERE c.usuario_id = $1
       ORDER BY c.id`,
      [req.user.id]
    );
    const itens = await montarItensCarrinho(rows);
    const total = itens.reduce(
      (s, i) => s + Number(i.preco_unitario_total) * i.quantidade,
      0
    );
    res.json({ itens, total: Number(total.toFixed(2)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao carregar carrinho' });
  }
});

router.post('/', async (req, res) => {
  const { produto_id, quantidade = 1 } = req.body;
  if (!produto_id) {
    return res.status(400).json({ error: 'produto_id é obrigatório' });
  }
  const client = await pool.connect();
  try {
    const q = Math.max(1, parseInt(String(quantidade), 10) || 1);

    let linhas = extrairLinhasDoBody(req.body);
    await client.query('BEGIN');
    await advisoryLockUsuario(client, req.user.id);
    linhas = await validarLinhasNoProduto(client, produto_id, linhas);

    const exists = await client.query(
      `SELECT id, quantidade FROM carrinho
       WHERE usuario_id = $1 AND produto_id = $2 AND adicional_quantidades = $3::jsonb`,
      [req.user.id, produto_id, JSON.stringify(linhas)]
    );
    if (exists.rows[0]) {
      const { rows } = await client.query(
        `UPDATE carrinho SET quantidade = quantidade + $1 WHERE id = $2
         RETURNING id, usuario_id, produto_id, quantidade, adicional_quantidades`,
        [q, exists.rows[0].id]
      );
      await client.query('COMMIT');
      return res.status(200).json(rows[0]);
    }
    const { rows } = await client.query(
      `INSERT INTO carrinho (usuario_id, produto_id, quantidade, adicional_quantidades)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, usuario_id, produto_id, quantidade, adicional_quantidades`,
      [req.user.id, produto_id, q, JSON.stringify(linhas)]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23503') {
      return res.status(400).json({ error: 'Produto inválido' });
    }
    if (e.status === 400) {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: 'Erro ao adicionar ao carrinho' });
  } finally {
    client.release();
  }
});

router.put('/:itemId', async (req, res) => {
  const { quantidade } = req.body;
  const q = parseInt(String(quantidade), 10);
  if (!Number.isFinite(q) || q < 1) {
    return res.status(400).json({ error: 'quantidade deve ser >= 1' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await advisoryLockUsuario(client, req.user.id);
    const { rows } = await client.query(
      `UPDATE carrinho SET quantidade = $1
       WHERE id = $2 AND usuario_id = $3
       RETURNING id, produto_id, quantidade, adicional_quantidades`,
      [q, req.params.itemId, req.user.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar item' });
  } finally {
    client.release();
  }
});

router.delete('/:itemId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await advisoryLockUsuario(client, req.user.id);
    const r = await client.query(
      'DELETE FROM carrinho WHERE id = $1 AND usuario_id = $2 RETURNING id',
      [req.params.itemId, req.user.id]
    );
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item não encontrado' });
    }
    await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Erro ao remover item' });
  } finally {
    client.release();
  }
});

export default router;
