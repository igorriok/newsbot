import { getDb } from "./connection";

export interface Chat {
  id: number;
  telegram_chat_id: number;
  created_at: string;
}

export function upsertChat(telegramChatId: number): Chat {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM chats WHERE telegram_chat_id = ?").get(telegramChatId) as Chat | undefined;
  if (existing) return existing;
  const info = db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (?)").run(telegramChatId);
  return { id: info.lastInsertRowid as number, telegram_chat_id: telegramChatId, created_at: new Date().toISOString() };
}

export function getChatByTelegramId(telegramChatId: number): Chat | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM chats WHERE telegram_chat_id = ?").get(telegramChatId) as Chat | undefined;
}
