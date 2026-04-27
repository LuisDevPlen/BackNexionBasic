import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireAdmin);

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, email, papel, created_at FROM usuario ORDER BY id'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

/** Admin cria usuário com papel definido */
router.post('/', async (req, res) => {
  try {
    const { nome, email, senha, papel } = req.body;
    if (!nome || !email || !senha || !papel) {
      return res.status(400).json({ error: 'nome, email, senha e papel são obrigatórios' });
    }
    if (!['admin', 'cliente'].includes(papel)) {
      return res.status(400).json({ error: 'papel deve ser admin ou cliente' });
    }
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuario (nome, email, senha_hash, papel)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nome, email, papel, created_at`,
      [nome, email.toLowerCase(), hash, papel]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

router.patch('/:id/role', async (req, res) => {
  try {
    const { papel } = req.body;
    if (!['admin', 'cliente'].includes(papel)) {
      return res.status(400).json({ error: 'papel deve ser admin ou cliente' });
    }
    const { rows } = await pool.query(
      'UPDATE usuario SET papel = $1 WHERE id = $2 RETURNING id, nome, email, papel',
      [papel, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar papel' });
  }
});

export default router;
