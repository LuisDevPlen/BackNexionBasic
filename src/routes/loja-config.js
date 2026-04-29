import { Router } from 'express';
import { pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

async function ensureRow() {
  await pool.query(
    `INSERT INTO loja_config (id, imprimir_pedido_automatico)
     VALUES (1, FALSE)
     ON CONFLICT (id) DO NOTHING`
  );
}

/** Lê opção da loja (só admin). */
router.get('/', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    await ensureRow();
    const { rows } = await pool.query(
      'SELECT imprimir_pedido_automatico FROM loja_config WHERE id = 1'
    );
    res.json({ imprimir_pedido_automatico: Boolean(rows[0]?.imprimir_pedido_automatico) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao ler configuração da loja' });
  }
});

/** Atualiza impressão automática de pedidos (só admin). */
router.patch('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const v = req.body?.imprimir_pedido_automatico;
    if (typeof v !== 'boolean') {
      return res.status(400).json({ error: 'imprimir_pedido_automatico deve ser true ou false' });
    }
    await ensureRow();
    await pool.query(
      `UPDATE loja_config
       SET imprimir_pedido_automatico = $1, updated_at = NOW()
       WHERE id = 1`,
      [v]
    );
    res.json({ imprimir_pedido_automatico: v });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao gravar configuração' });
  }
});

export default router;
