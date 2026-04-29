import { Router } from 'express';
import { pool, advisoryLockUsuario } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import {
  enrichItensComAdicionais,
  normalizarAdicionalItens,
  parseLinhasDb,
} from '../pedido-detail.js';
import { sendPedidoNovoEmail } from '../mail-notify.js';

const router = Router();

const FORMAS_PAGAMENTO = ['dinheiro', 'cartao', 'pix'];

async function somaExtrasLinhas(client, linhas) {
  if (!linhas.length) return 0;
  let sum = 0;
  for (const row of linhas) {
    const { rows } = await client.query('SELECT preco FROM adicional WHERE id = $1', [row.adicional_id]);
    if (rows[0]) sum += Number(rows[0].preco) * row.quantidade;
  }
  return sum;
}

/** Lista: admin vê todos; cliente vê só os seus */
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query;
    let params;
    if (req.user.papel === 'admin') {
      query = `
        SELECT p.id, p.usuario_id, p.status, p.total, p.created_at,
               p.forma_pagamento, p.endereco_entrega,
               u.nome AS usuario_nome, u.email AS usuario_email
        FROM pedido p
        JOIN usuario u ON u.id = p.usuario_id
        ORDER BY p.created_at DESC`;
      params = [];
    } else {
      query = `
        SELECT id, usuario_id, status, total, created_at, forma_pagamento, endereco_entrega
        FROM pedido WHERE usuario_id = $1
        ORDER BY created_at DESC`;
      params = [req.user.id];
    }
    const { rows: pedidos } = await pool.query(query, params);
    res.json(pedidos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao listar pedidos' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    let pedidoRes;
    if (req.user.papel === 'admin') {
      pedidoRes = await pool.query(
        `SELECT p.*, u.nome AS usuario_nome, u.email AS usuario_email
         FROM pedido p JOIN usuario u ON u.id = p.usuario_id WHERE p.id = $1`,
        [id]
      );
    } else {
      pedidoRes = await pool.query('SELECT * FROM pedido WHERE id = $1 AND usuario_id = $2', [
        id,
        req.user.id,
      ]);
    }
    const pedido = pedidoRes.rows[0];
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
    const itens = await pool.query(
      `SELECT pi.*, pr.nome AS produto_nome
       FROM pedido_item pi
       JOIN produto pr ON pr.id = pi.produto_id
       WHERE pi.pedido_id = $1`,
      [id]
    );
    const itensComAdicionais = await enrichItensComAdicionais(itens.rows);
    res.json({ ...pedido, itens: itensComAdicionais });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao buscar pedido' });
  }
});

/** Finaliza compra: copia carrinho para pedido (pendente) e esvazia carrinho */
router.post('/checkout', authenticateToken, async (req, res) => {
  const { forma_pagamento, endereco_entrega } = req.body ?? {};
  if (!FORMAS_PAGAMENTO.includes(forma_pagamento)) {
    return res.status(400).json({
      error: 'Informe forma_pagamento: dinheiro, cartao ou pix',
    });
  }
  const addr = typeof endereco_entrega === 'string' ? endereco_entrega.trim() : '';
  if (addr.length < 8) {
    return res.status(400).json({ error: 'Informe o endereço completo para entrega' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await advisoryLockUsuario(client, req.user.id);
    const cart = await client.query(
      `SELECT c.id, c.produto_id, c.quantidade, c.adicional_quantidades, p.preco
       FROM carrinho c
       JOIN produto p ON p.id = c.produto_id
       WHERE c.usuario_id = $1`,
      [req.user.id]
    );
    if (!cart.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Carrinho vazio' });
    }

    let total = 0;
    for (const line of cart.rows) {
      const linhas = normalizarAdicionalItens(parseLinhasDb(line.adicional_quantidades));
      const extras = await somaExtrasLinhas(client, linhas);
      total += (Number(line.preco) + extras) * line.quantidade;
    }
    await client.query(`UPDATE usuario SET endereco_entrega = $1 WHERE id = $2`, [addr, req.user.id]);

    const pedidoIns = await client.query(
      `INSERT INTO pedido (usuario_id, status, total, forma_pagamento, endereco_entrega)
       VALUES ($1, 'pendente', $2, $3, $4)
       RETURNING id, usuario_id, status, total, created_at, forma_pagamento, endereco_entrega`,
      [req.user.id, total, forma_pagamento, addr]
    );
    const pedido = pedidoIns.rows[0];
    for (const line of cart.rows) {
      const linhas = normalizarAdicionalItens(parseLinhasDb(line.adicional_quantidades));
      const extrasUnit = await somaExtrasLinhas(client, linhas);
      const jsonLinhas = JSON.stringify(linhas);
      await client.query(
        `INSERT INTO pedido_item (pedido_id, produto_id, quantidade, preco_unitario, extras_unitario, adicional_quantidades)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [pedido.id, line.produto_id, line.quantidade, line.preco, extrasUnit, jsonLinhas]
      );
    }
    await client.query('DELETE FROM carrinho WHERE usuario_id = $1', [req.user.id]);
    await client.query('COMMIT');
    res.status(201).json(pedido);

    const pid = pedido.id;
    setImmediate(() => {
      sendPedidoNovoEmail(pid).catch((err) => console.error('[mail] Falha ao enviar e-mail:', err.message));
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    if (e.code === '40P01') {
      return res.status(503).json({
        error: 'Sistema ocupado. Tente finalizar o pedido de novo em instantes.',
        code: 'deadlock',
      });
    }
    res.status(500).json({ error: 'Erro ao finalizar pedido' });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pendente', 'aprovado', 'rejeitado'].includes(status)) {
      return res.status(400).json({ error: 'status inválido' });
    }
    const { rows } = await pool.query(
      'UPDATE pedido SET status = $1 WHERE id = $2 RETURNING id, usuario_id, status, total, created_at',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

export default router;
