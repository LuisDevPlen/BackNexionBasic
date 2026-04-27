import { Router } from 'express';
import { pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, created_at FROM categoria ORDER BY nome'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao listar categorias' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const nome = String(req.body?.nome ?? '').trim();
    if (!nome) {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }
    const { rows } = await pool.query(
      `INSERT INTO categoria (nome) VALUES ($1)
       ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id, nome, created_at`,
      [nome]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const nome = String(req.body?.nome ?? '').trim();
    if (!nome) {
      return res.status(400).json({ error: 'nome é obrigatório' });
    }
    const { rows } = await pool.query(
      `UPDATE categoria SET nome = $1 WHERE id = $2 RETURNING id, nome, created_at`,
      [nome, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Categoria não encontrada' });

    await pool.query(
      `UPDATE produto SET categoria = $1 WHERE categoria_id = $2`,
      [nome, req.params.id]
    );

    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar categoria' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE produto SET categoria_id = NULL, categoria = NULL WHERE categoria_id = $1`,
      [req.params.id]
    );
    const r = await client.query(`DELETE FROM categoria WHERE id = $1 RETURNING id`, [
      req.params.id,
    ]);
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Erro ao remover categoria' });
  } finally {
    client.release();
  }
});

export default router;
