import { DisconnectReason, WAMessageStatus } from '@whiskeysockets/baileys';
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';

const authDir = '/home/abdhnf/dev/wa-server-backend/data/auth/sess-mtti2y7b';
const { state, saveCreds } = await useMultiFileAuthState(authDir);
const { version } = await fetchLatestBaileysVersion();
const sock = makeWASocket({
  version,
  auth: state,
  logger: pino({ level: 'debug' }),
});

sock.ev.on('creds.update', saveCreds);
sock.ev.on('messages.update', (updates) => {
  console.log('FULL messages.update:', JSON.stringify(updates, null, 2));
});
sock.ev.on('connection.update', async (u) => {
  if (u.connection === 'open') {
    console.log('Open!');
    const res = await sock.sendMessage('6282242168002@s.whatsapp.net', { text: 'Testing debug update' });
    console.log('Sent res:', res.key);
  }
});

setTimeout(() => {
  console.log('Timeout exiting');
  process.exit(0);
}, 8000);
