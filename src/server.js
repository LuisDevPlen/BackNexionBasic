import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool, initDb } from './db.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import categoriasRoutes from './routes/categorias.js';
import adicionaisRoutes from './routes/adicionais.js';
import userRoutes from './routes/users.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
    credentials: true,
  })
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/adicionais', adicionaisRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);

async function seedSampleProducts() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM produto');
  if (rows[0].c > 0) return;

  await pool.query(
    `INSERT INTO categoria (nome) VALUES ('Eletrônicos'), ('Áudio'), ('Acessórios')
     ON CONFLICT (nome) DO NOTHING`
  );

  const catRows = await pool.query(
    `SELECT id, nome FROM categoria WHERE nome IN ('Eletrônicos', 'Áudio', 'Acessórios')`
  );
  const catId = Object.fromEntries(catRows.rows.map((r) => [r.nome, r.id]));

  await pool.query(
    `INSERT INTO produto (nome, preco, descricao, categoria, categoria_id, imagem_url) VALUES
     ('Notebook Pro', 4299.00, '16 GB RAM, SSD 512 GB', 'Eletrônicos', $1, 'https://picsum.photos/seed/nexion-note/400/280'),
     ('Fone Bluetooth', 189.90, 'Cancelamento de ruído', 'Áudio', $2, 'https://picsum.photos/seed/nexion-fone/400/280'),
     ('Mochila Urban', 149.00, 'Compartimento para notebook 15"', 'Acessórios', $3, 'https://picsum.photos/seed/nexion-bag/400/280')`,
    [catId['Eletrônicos'], catId['Áudio'], catId['Acessórios']]
  );

  console.log('Produtos de exemplo inseridos.');
}

async function ensureDefaultAdmin() {
  const email = (process.env.ADMIN_SEED_EMAIL || 'admin@nexion.local').toLowerCase();
  const senha = process.env.ADMIN_SEED_PASSWORD || 'admin123';
  const { rows } = await pool.query('SELECT id FROM usuario WHERE email = $1', [email]);
  if (rows.length) return;
  const hash = await bcrypt.hash(senha, 10);
  await pool.query(
    `INSERT INTO usuario (nome, email, senha_hash, papel)
     VALUES ($1, $2, $3, 'admin')`,
    ['Administrador', email, hash]
  );
  console.log(`Usuário admin criado: ${email} (altere a senha em produção)`);
}

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('Defina DATABASE_URL no arquivo .env (veja .env.example)');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('Defina JWT_SECRET no arquivo .env');
    process.exit(1);
  }
  await initDb();
  await ensureDefaultAdmin();
  await seedSampleProducts();
  app.listen(PORT, () => {
    console.log(`API Nexion em http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
