import { pool } from './db.js';

export function parseLinhasDb(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const j = JSON.parse(val);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizarAdicionalItens(arr) {
  if (!Array.isArray(arr) || !arr.length) return [];
  const map = new Map();
  for (const row of arr) {
    const aid = parseInt(row.adicional_id ?? row.id, 10);
    const raw = parseInt(row.quantidade ?? row.qtd ?? 0, 10);
    const q = Math.min(999, Math.max(0, Number.isFinite(raw) ? raw : 0));
    if (!Number.isFinite(aid) || q <= 0) continue;
    map.set(aid, (map.get(aid) ?? 0) + q);
  }
  const out = [...map.entries()].map(([adicional_id, quantidade]) => ({ adicional_id, quantidade }));
  out.sort((a, b) => a.adicional_id - b.adicional_id);
  return out;
}

/** Enriquece com nome/preço e quantidade por adicional */
export async function enrichItensComAdicionais(rows) {
  const out = [];
  for (const row of rows) {
    const linhas = normalizarAdicionalItens(parseLinhasDb(row.adicional_quantidades));
    const adicionais = [];
    for (const l of linhas) {
      const { rows: ads } = await pool.query(`SELECT id, nome, preco FROM adicional WHERE id = $1`, [
        l.adicional_id,
      ]);
      if (ads[0]) {
        adicionais.push({
          id: ads[0].id,
          nome: ads[0].nome,
          preco: ads[0].preco,
          quantidade: l.quantidade,
        });
      }
    }
    out.push({ ...row, adicionais });
  }
  return out;
}

/** Pedido completo como na rota admin GET /orders/:id (para e-mail, etc.). */
export async function getPedidoDetalheAdmin(pedidoId) {
  const pedidoRes = await pool.query(
    `SELECT p.*, u.nome AS usuario_nome, u.email AS usuario_email
     FROM pedido p JOIN usuario u ON u.id = p.usuario_id WHERE p.id = $1`,
    [pedidoId]
  );
  const pedido = pedidoRes.rows[0];
  if (!pedido) return null;
  const itens = await pool.query(
    `SELECT pi.*, pr.nome AS produto_nome
     FROM pedido_item pi
     JOIN produto pr ON pr.id = pi.produto_id
     WHERE pi.pedido_id = $1`,
    [pedidoId]
  );
  const itensComAdicionais = await enrichItensComAdicionais(itens.rows);
  return { ...pedido, itens: itensComAdicionais };
}
