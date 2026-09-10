// Konfigurasi env. Semua bisa di-override via process.env.
export const config = {
  port: Number(process.env.PORT || 3100),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DATABASE_PATH || new URL('../data/wa.db', import.meta.url).pathname,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-ganti-produksi',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  // Default pacing anti-ban (gaussian jitter bounds)
  antiBan: {
    minDelayMs: Number(process.env.AB_MIN_DELAY_MS || 1500),
    maxDelayMs: Number(process.env.AB_MAX_DELAY_MS || 3200),
    maxPerMinute: Number(process.env.AB_MAX_PER_MINUTE || 10),
  },
};