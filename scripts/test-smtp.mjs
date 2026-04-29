/**
 * Testa envio SMTP (usa variáveis do .env na raiz do BackEndNexion).
 * Uso: node scripts/test-smtp.mjs
 */
import 'dotenv/config';
import nodemailer from 'nodemailer';

const host = (process.env.MAIL_HOST ?? '').trim();
const port = parseInt(process.env.MAIL_PORT ?? '587', 10);
const user = (process.env.MAIL_USER ?? '').trim();
const pass = (process.env.MAIL_PASS ?? '').trim();
const to = (process.env.MAIL_TO ?? '').trim();
const from = (process.env.MAIL_FROM ?? process.env.MAIL_USER ?? '').trim();

if (!host || !user || !pass) {
  console.error('Faltam MAIL_HOST, MAIL_USER ou MAIL_PASS no .env');
  process.exit(1);
}
if (!to || !from) {
  console.error('Faltam MAIL_TO ou MAIL_FROM no .env');
  process.exit(1);
}

const secure = process.env.MAIL_SECURE === 'true' || port === 465;
const transport = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
  ...( !secure && port === 587 ? { requireTLS: true } : {} ),
});

try {
  await transport.verify();
  console.log('SMTP: conexão/autenticação OK');
  const info = await transport.sendMail({
    from,
    to,
    subject: '[Nexion] Teste de e-mail',
    text: 'Se recebeu isto, o envio de pedidos por e-mail deve funcionar.',
  });
  console.log('Mensagem enviada:', info.messageId);
} catch (e) {
  console.error('Erro:', e.message);
  process.exit(1);
}
