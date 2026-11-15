/**
 * Titik masuk wa-api.
 *
 * Berkas ini sengaja tipis: ia menyusun aplikasi lalu menyerahkan pendaftaran
 * rute ke modul per domain di `routes/`. Isi rutenya TIDAK berubah saat dipecah
 * — hanya dipindahkan, sehingga perilaku yang sudah teruji tetap sama.
 *
 * Urutan pendaftaran tidak memengaruhi hasil: setiap rute punya pola dan metode
 * yang berbeda, tidak ada dua rute yang bertabrakan.
 */
import { config } from './config.js';
import { app, manager } from './routes/konteks.js';
import { daftarkanRuteAuth } from './routes/auth.js';
import { daftarkanRuteUsers } from './routes/users.js';
import { daftarkanRuteSessions } from './routes/sessions.js';
import { daftarkanRutePesan } from './routes/pesan.js';
import { daftarkanRuteInbox } from './routes/inbox.js';
import { daftarkanRuteWebhook } from './routes/webhook.js';
import { daftarkanRuteChatbot } from './routes/chatbot.js';
import { daftarkanRutePengaturan } from './routes/pengaturan.js';
import { daftarkanRuteOperasional } from './routes/operasional.js';
import { jadwalkanRetensiApiLogs } from './retensi.js';
import { mulaiWorkerWebhook } from './webhook.js';

daftarkanRuteAuth(app);
daftarkanRuteUsers(app);
daftarkanRuteSessions(app);
daftarkanRutePesan(app);
daftarkanRuteInbox(app);
daftarkanRuteWebhook(app);
daftarkanRuteChatbot(app);
daftarkanRutePengaturan(app);
daftarkanRuteOperasional(app);

const port = config.port;
try {
  await app.listen({ port, host: config.host });
  // Pulihkan antrean pesan yang belum terkirim dari SQLite
  await manager.recoverPendingMessages();
  // Retensi `api_logs`: baris audit tidak bisa dihapus pemiliknya, jadi
  // pembersihannya harus dari sisi server. Dijadwalkan setelah listen supaya
  // kegagalannya tidak menghalangi server melayani permintaan.
  jadwalkanRetensiApiLogs();
  // Worker webhook: mengirim antrean `webhook_deliveries` dengan retry.
  // Dijalankan setelah listen supaya kegagalannya tidak menghalangi server.
  mulaiWorkerWebhook();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
