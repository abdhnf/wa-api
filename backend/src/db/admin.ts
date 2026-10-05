import { generateApiKey, hashPassword } from '../security.js';
import { db } from './client.js';
import { createUser } from './users.js';

// Otomatis seed Super Admin pertama jika database baru/kosong (Fresh Install)
export function seedDefaultAdmin(): void {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (row && row.count === 0) {
      const email = process.env.ADMIN_EMAIL || 'admin@example.com';
      const rawPassword = process.env.ADMIN_PASSWORD || 'admin123';
      const name = process.env.ADMIN_NAME || 'Super Admin';

      const admin = createUser({
        name,
        email,
        passwordHash: hashPassword(rawPassword),
        role: 'admin',
        apiKey: generateApiKey('wa_live'),
        quotaPerDay: 100000,
        quotaPerWeek: 700000,
        status: 'active',
      });

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(' [BOOTSTRAP] Fresh installation detected!');
      console.log(' Default Super Admin account successfully created:');
      console.log(`   Email   : ${admin.email}`);
      console.log(`   Password: ${rawPassword}`);
      console.log(`   API Key : ${admin.apiKey}`);
      console.log('   PENTING : Segera ganti password ini di panel admin!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  } catch (err: any) {
    console.error('[BOOTSTRAP ERROR] Failed to auto-seed default admin:', err.message);
  }
}
