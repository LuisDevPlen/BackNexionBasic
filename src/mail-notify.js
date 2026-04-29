import nodemailer from 'nodemailer';
import { getPedidoDetalheAdmin } from './pedido-detail.js';

function fmtBrl(n) {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function labelForma(cod) {
  const map = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' };
  return map[cod] ?? cod ?? '—';
}

function buildPedidoTexto(d) {
  const linhas = [
    `Novo pedido #${d.id}`,
    `Data: ${d.created_at}`,
    `Cliente: ${d.usuario_nome ?? '—'} (${d.usuario_email ?? '—'})`,
    `Total: ${fmtBrl(d.total)}`,
    `Status: ${d.status}`,
    `Pagamento: ${labelForma(d.forma_pagamento)}`,
    `Endereço de entrega:\n${d.endereco_entrega ?? '—'}`,
    '',
    'Itens:',
  ];
  for (const it of d.itens ?? []) {
    const base = Number(it.preco_unitario);
    const ex = Number(it.extras_unitario ?? 0);
    const sub = (base + ex) * it.quantidade;
    linhas.push(`• ${it.quantidade}× ${it.produto_nome} — ${fmtBrl(sub)}`);
    linhas.push(`  (produto ${fmtBrl(it.preco_unitario)} × ${it.quantidade})`);
    for (const ad of it.adicionais ?? []) {
      const adSub = Number(ad.preco) * ad.quantidade * it.quantidade;
      linhas.push(
        `    + ${ad.nome}: ${fmtBrl(ad.preco)} × ${ad.quantidade}/un. × ${it.quantidade} und. = ${fmtBrl(adSub)}`
      );
    }
  }
  return linhas.join('\n');
}

function buildPedidoHtml(d) {
  const itensHtml = (d.itens ?? [])
    .map((it) => {
      const base = Number(it.preco_unitario);
      const ex = Number(it.extras_unitario ?? 0);
      const sub = (base + ex) * it.quantidade;
      const ads = (it.adicionais ?? [])
        .map((ad) => {
          const adSub = Number(ad.preco) * ad.quantidade * it.quantidade;
          return `<li>${ad.nome}: ${fmtBrl(ad.preco)} × ${ad.quantidade}/un. × ${it.quantidade} und. = <strong>${fmtBrl(adSub)}</strong></li>`;
        })
        .join('');
      return `<tr><td colspan="2"><strong>${it.quantidade}× ${it.produto_nome}</strong> — ${fmtBrl(sub)}<br/><small>Produto: ${fmtBrl(it.preco_unitario)} × ${it.quantidade}</small>${ads ? `<ul style="margin:4px 0 0 16px">${ads}</ul>` : ''}</td></tr>`;
    })
    .join('');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif">
<h2>Novo pedido #${d.id}</h2>
<p><strong>Cliente:</strong> ${escapeHtml(d.usuario_nome ?? '—')} &lt;${escapeHtml(d.usuario_email ?? '')}&gt;<br/>
<strong>Total:</strong> ${fmtBrl(d.total)}<br/>
<strong>Pagamento:</strong> ${labelForma(d.forma_pagamento)}<br/>
<strong>Status:</strong> ${d.status}</p>
<h3>Endereço de entrega</h3>
<p style="white-space:pre-wrap">${escapeHtml(d.endereco_entrega ?? '—')}</p>
<h3>Itens</h3>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">${itensHtml}</table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createTransport() {
  const host = (process.env.MAIL_HOST ?? '').trim();
  const port = parseInt(process.env.MAIL_PORT ?? '587', 10);
  const user = (process.env.MAIL_USER ?? '').trim();
  const passRaw = process.env.MAIL_PASS;
  const pass = passRaw != null ? String(passRaw).trim() : '';
  if (!host || !user || !pass) return null;
  const secure = process.env.MAIL_SECURE === 'true' || port === 465;
  const opts = {
    host,
    port,
    secure,
    auth: { user, pass },
  };
  if (!secure && port === 587) {
    opts.requireTLS = true;
  }
  return nodemailer.createTransport(opts);
}

/**
 * Envia e-mail de novo pedido para MAIL_TO (vários separados por vírgula).
 * Sem MAIL_TO ou SMTP incompleto: não faz nada.
 */
export async function sendPedidoNovoEmail(pedidoId) {
  const toRaw = (process.env.MAIL_TO ?? '').trim();
  if (!toRaw) {
    console.warn('[mail] MAIL_TO não definido no .env — e-mail não enviado.');
    return;
  }

  const from = (process.env.MAIL_FROM ?? process.env.MAIL_USER ?? '').trim();
  if (!from) {
    console.warn('[mail] Defina MAIL_FROM ou MAIL_USER no .env — e-mail não enviado.');
    return;
  }

  const transport = createTransport();
  if (!transport) {
    console.warn(
      '[mail] SMTP incompleto. No .env ative MAIL_HOST, MAIL_USER e MAIL_PASS (Gmail: use "Senha de app" com verificação em 2 passos). Sem isso o pedido grava na base mas o e-mail não sai.'
    );
    return;
  }

  const d = await getPedidoDetalheAdmin(pedidoId);
  if (!d) {
    console.warn('[mail] Pedido não encontrado para e-mail:', pedidoId);
    return;
  }

  const to = toRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const subject = `[Nexion] Novo pedido #${d.id} — ${fmtBrl(d.total)}`;

  try {
    const info = await transport.sendMail({
      from,
      to: to.join(', '),
      subject,
      text: buildPedidoTexto(d),
      html: buildPedidoHtml(d),
    });
    console.log('[mail] Pedido #%s: e-mail enviado para %s (%s)', pedidoId, to.join(', '), info.messageId);
  } catch (e) {
    console.error('[mail] Pedido #%s: falha SMTP — %s', pedidoId, e.message);
    throw e;
  }
}
