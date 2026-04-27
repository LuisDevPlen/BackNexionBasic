import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, papel: user.papel },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/** Cadastro público — papel fixo cliente */
router.post('/register', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'nome, email e senha são obrigatórios' });
    }
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuario (nome, email, senha_hash, papel)
       VALUES ($1, $2, $3, 'cliente')
       RETURNING id, nome, email, papel, endereco_entrega`,
      [nome, email.toLowerCase(), hash]
    );
    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erro ao registrar' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'email e senha são obrigatórios' });
    }
    const { rows } = await pool.query(
      'SELECT id, nome, email, senha_hash, papel, endereco_entrega FROM usuario WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    delete user.senha_hash;
    const token = signToken(user);
    res.json({ user, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao autenticar' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, email, papel, endereco_entrega FROM usuario WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao carregar perfil' });
  }
});

/** Atualiza endereço de entrega salvo no perfil (PATCH e PUT) */
async function atualizarPerfilEndereco(req, res) {
  try {
    const { endereco_entrega } = req.body ?? {};
    if (typeof endereco_entrega !== 'string') {
      return res.status(400).json({ error: 'Informe endereco_entrega (texto ou string vazia para limpar)' });
    }
    const trimmed = String(endereco_entrega).trim();
    const stored = trimmed === '' ? null : trimmed;
    const { rows } = await pool.query(
      `UPDATE usuario SET endereco_entrega = $1 WHERE id = $2
       RETURNING id, nome, email, papel, endereco_entrega`,
      [stored, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
}

router.patch('/profile', authenticateToken, atualizarPerfilEndereco);
router.put('/profile', authenticateToken, atualizarPerfilEndereco);

export default router;
