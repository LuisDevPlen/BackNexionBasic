import { Router } from 'express';
import { pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, preco, descricao, created_at FROM adicional ORDER BY nome'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao listar adicionais' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const nome = String(req.body?.nome ?? '').trim();
    const preco = req.body?.preco != null ? Number(req.body.preco) : 0;
    const descricao = req.body?.descricao != null ? String(req.body.descricao) : null;
    if (!nome) {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }
    if (!Number.isFinite(preco) || preco < 0) {
      return res.status(400).json({ error: 'preco inválido' });
    }
    const { rows } = await pool.query(
      `INSERT INTO adicional (nome, preco, descricao)
       VALUES ($1, $2, $3)
       RETURNING id, nome, preco, descricao, created_at`,
      [nome, preco, descricao]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao criar adicional' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const nome = String(req.body?.nome ?? '').trim();
    const preco = req.body?.preco != null ? Number(req.body.preco) : undefined;
    const descricao = req.body?.descricao !== undefined ? req.body.descricao : undefined;
    if (!nome) {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }
    if (preco !== undefined && (!Number.isFinite(preco) || preco < 0)) {
      return res.status(400).json({ error: 'preco inválido' });
    }
    const { rows } = await pool.query(
      `UPDATE adicional SET
        nome = $1,
        preco = COALESCE($2, preco),
        descricao = COALESCE($3, descricao)
       WHERE id = $4
       RETURNING id, nome, preco, descricao, created_at`,
      [nome, preco ?? null, descricao ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Adicional não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar adicional' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM adicional WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (!r.rowCount) return res.status(404).json({ error: 'Adicional não encontrado' });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao remover adicional' });
  }
});

export default router;
