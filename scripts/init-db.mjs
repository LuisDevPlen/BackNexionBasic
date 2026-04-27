/**
 * Cria o banco "NexionDatabase" (se não existir) e aplica sql/schema.sql.
 * Usa conexão ao banco "postgres" para o CREATE DATABASE.
 *
 * Uso:
 *   set DATABASE_URL_ADMIN=postgresql://postgres:SUA_SENHA@localhost:5432/postgres
 *   npm run db:init
 *
 * Se não definir DATABASE_URL_ADMIN, usa postgresql://postgres:9191@localhost:5432/postgres
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DB_NAME = 'NexionDatabase';

function adminUrl() {
  const u = process.env.DATABASE_URL_ADMIN;
  if (u) return u;
  return 'postgresql://postgres:9191@localhost:5432/postgres';
}

function appUrl() {
  const u = process.env.DATABASE_URL_ADMIN || adminUrl();
  try {
    const url = new URL(u);
    url.pathname = `/${DB_NAME}`;
    return url.toString();
  } catch {
    return `postgresql://postgres:9191@localhost:5432/${DB_NAME}`;
  }
}

async function main() {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  const check = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (!check.rowCount) {
    await admin.query(`CREATE DATABASE "${DB_NAME}" ENCODING 'UTF8'`);
    console.log(`Banco "${DB_NAME}" criado.`);
  } else {
    console.log(`Banco "${DB_NAME}" já existe.`);
  }
  await admin.end();

  const app = new pg.Client({ connectionString: appUrl() });
  await app.connect();
  const schema = fs.readFileSync(path.join(root, 'sql', 'schema.sql'), 'utf8');
  await app.query(schema);
  console.log('Tabelas aplicadas (schema.sql).');
  await app.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
