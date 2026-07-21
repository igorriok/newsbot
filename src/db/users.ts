import { getDb } from "./connection";

export interface User {
  id: number;
  telegram_id: number;
  created_at: string;
}

export function upsertUser(telegramId: number): User {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId) as User | undefined;
  if (existing) return existing;
  const info = db.prepare("INSERT INTO users (telegram_id) VALUES (?)").run(telegramId);
  return { id: info.lastInsertRowid as number, telegram_id: telegramId, created_at: new Date().toISOString() };
}

export function getUserByTelegramId(telegramId: number): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId) as User | undefined;
}
