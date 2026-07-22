import type Database from "better-sqlite3";
import { getDb } from "./connection";

export interface Chat {
  id: number;
  telegram_chat_id: number;
  created_at: string;
}

export function upsertChat(telegramChatId: number): Chat {
  const db: Database.Database = getDb();
  const existing: Chat | undefined = db
    .prepare<[number], Chat>("SELECT * FROM chats WHERE telegram_chat_id = ?")
    .get(telegramChatId);

  if (existing) return existing;

  const info: Database.RunResult = db.prepare("INSERT INTO chats (telegram_chat_id) VALUES (?)").run(telegramChatId);

  return {
    id: Number(info.lastInsertRowid),
    telegram_chat_id: telegramChatId,
    created_at: new Date().toISOString(),
  };
}

export function getChatByTelegramId(telegramChatId: number): Chat | undefined {
  const db: Database.Database = getDb();
  return db.prepare<[number], Chat>("SELECT * FROM chats WHERE telegram_chat_id = ?").get(telegramChatId);
}
