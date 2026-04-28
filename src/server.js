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

/** Várias origens: CORS_ORIGIN="https://front.vercel.app,http://localhost:4200" */
function corsAllowedList() {
  const raw = process.env.CORS_ORIGIN || 'http://localhost:4200';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

app.use(
  cors({
    origin(origin, callback) {
      const allowed = corsAllowedList();
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'Nexion API',
    docs: { health: '/api/health', products: '/api/products' },
  });
});

/** Health sem BD — útil na Vercel/Observability mesmo se DATABASE_URL falhar */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

/** Na Vercel (serverless), prepara BD antes das rotas que precisam do pool — uma vez por cold start */
let preparePromise;
async function prepareServer() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Defina DATABASE_URL (Neon ou Postgres)');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('Defina JWT_SECRET');
  }
  await initDb();
  await ensureDefaultAdmin();
  await seedSampleProducts();
}

app.use(async (_req, _res, next) => {
  try {
    preparePromise ||= prepareServer();
    await preparePromise;
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/adicionais', adicionaisRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erro interno' });
});

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

async function startLocal() {
  await prepareServer();
  app.listen(PORT, () => {
    console.log(`API Nexion em http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startLocal().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export default app;
