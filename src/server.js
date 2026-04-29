import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { pool, initDb } from './db.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import categoriasRoutes from './routes/categorias.js';
import adicionaisRoutes from './routes/adicionais.js';
import userRoutes from './routes/users.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import lojaConfigRoutes from './routes/loja-config.js';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Imagens enviadas pelo admin (produtos): GET /uploads/products/… */
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

/** Várias origens: CORS_ORIGIN="https://front.vercel.app,http://localhost:4200" */
function corsAllowedList() {
  const raw = process.env.CORS_ORIGIN || 'http://localhost:4200';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Preview na Vercel usa URL longa (branch / PR), ex.:
 * https://front-nexion-basic-git-main-xxxx.vercel.app — não coincide com produção curta.
 */
function isOriginAllowed(origin) {
  if (!origin) return true;
  if (corsAllowedList().includes(origin)) return true;

  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();

    // localhost Angular dev
    if (host === 'localhost' || host === '127.0.0.1') return true;

    /** Front Nexion na Vercel (produção ou preview Git) — hostname inclui "nexion" */
    if (host.endsWith('.vercel.app') && /nexion/i.test(host)) return true;

    /** Desativar por defeito; defina "1" só se precisar abrir outros *.vercel.app no mesmo projeto */
    if (process.env.CORS_ALLOW_ANY_VERCEL === '1' && host.endsWith('.vercel.app')) return true;
  } catch {
    return false;
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
/** Produtos com imagem em base64 no JSON — limite explícito em bytes (evita falhas de parsing de string tipo "12mb") */
const JSON_BODY_LIMIT = 52 * 1024 * 1024; // 52 MB
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

/**
 * Na Vercel (serverless), o pedido pode chegar sem o prefixo /api que as rotas usam.
 * Sem isto: GET /api/loja-config → Express pode ver só /loja-config → 404 "Cannot GET /api/loja-config".
 */
if (process.env.VERCEL) {
  app.use((req, _res, next) => {
    const raw = req.url ?? '/';
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    const pathPart = raw.split('?')[0] || '/';
    if (
      pathPart !== '/' &&
      !pathPart.startsWith('/api') &&
      !pathPart.startsWith('/uploads')
    ) {
      const fixed = '/api' + (pathPart.startsWith('/') ? pathPart : '/' + pathPart) + q;
      req.url = fixed;
      req.originalUrl = fixed;
    }
    next();
  });
}

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

app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
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
app.use('/api/loja-config', lojaConfigRoutes);

function applyCorsOnError(req, res) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

app.use((err, req, res, _next) => {
  applyCorsOnError(req, res);
  const tooLarge =
    err?.status === 413 ||
    err?.statusCode === 413 ||
    err?.type === 'entity.too.large' ||
    err?.name === 'PayloadTooLargeError' ||
    /too large/i.test(String(err?.message ?? ''));
  if (tooLarge) {
    return res.status(413).json({
      error:
        'Pedido demasiado grande (imagem em base64). Escolha uma foto mais pequena ou comprima antes.',
    });
  }
  console.error(err);
  const status = Number(err?.statusCode || err?.status) || 500;
  res.status(status).json({ error: err.message || 'Erro interno' });
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
