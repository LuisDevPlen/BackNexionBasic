import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/** Namespace fixo para pg_advisory_xact_lock (par de inteiros). */
export const ADV_LOCK_USER_NS = 884_401;

/**
 * Serializa, por utilizador, alterações a carrinho/checkout/perfil que tocam `usuario` + `carrinho`,
 * evitando deadlocks quando duas transações bloqueiam linhas em ordens diferentes.
 * Deve ser chamado dentro de BEGIN no mesmo `client`.
 */
export async function advisoryLockUsuario(client, usuarioId) {
  await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [
    ADV_LOCK_USER_NS,
    usuarioId,
  ]);
}

export async function initDb() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
}
