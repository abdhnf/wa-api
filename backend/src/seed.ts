import { hashPassword, generateApiKey } from './security.js';
import { createUser } from './db.js';

// Seed: admin default + 2 user demo. Hapus/ubah sebelum production!
const admin = createUser({
  name: 'Admin',
  email: 'admin@abdhnf.com',
  passwordHash: hashPassword('admin123'),
  role: 'admin',
  apiKey: generateApiKey('wa_admin'),
  quotaPerDay: 100000,
  status: 'active',
});

const user1 = createUser({
  name: 'Backend E-Commerce',
  email: 'backend@fapet.id',
  passwordHash: hashPassword('backend123'),
  role: 'user',
  apiKey: generateApiKey('wa'),
  quotaPerDay: 1000,
  status: 'active',
});

const user2 = createUser({
  name: 'Testing Script',
  email: 'dev@abdhnf.com',
  passwordHash: hashPassword('dev123'),
  role: 'user',
  apiKey: generateApiKey('wa'),
  quotaPerDay: 100,
  status: 'active',
});

console.log('Seed selesai. User demo:');
console.log(`  Admin : ${admin.email} / admin123 | API key: ${admin.apiKey}`);
console.log(`  User1 : ${user1.email} / backend123 | API key: ${user1.apiKey}`);
console.log(`  User2 : ${user2.email} / dev123 | API key: ${user2.apiKey}`);