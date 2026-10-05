import { config } from '../config.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Node 22+ node:sqlite (stdlib, nol dependency). Warning experimental bisa di-silence
// dengan --no-warnings di production.

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
