import type Database from "better-sqlite3";
import { getDb } from "./connection";

export interface Topic {
  id: number;
  chat_id: number;
  phrase: string;
  created_at: string;
}

export function insertTopic(chatId: number, phrase: string): Topic {
  const db: Database.Database = getDb();
  const info: Database.RunResult = db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (?, ?)").run(chatId, phrase);

  return {
    id: Number(info.lastInsertRowid),
    chat_id: chatId,
    phrase,
    created_at: new Date().toISOString(),
  };
}

export function deleteTopic(id: number, chatId: number): boolean {
  const db: Database.Database = getDb();
  const info: Database.RunResult = db.prepare("DELETE FROM topics WHERE id = ? AND chat_id = ?").run(id, chatId);

  return info.changes > 0;
}

export function getTopicsForChat(chatId: number): Topic[] {
  const db: Database.Database = getDb();
  return db.prepare<[number], Topic>("SELECT * FROM topics WHERE chat_id = ?").all(chatId);
}

export function getTopicByChatAndPhrase(chatId: number, phrase: string): Topic | undefined {
  const db: Database.Database = getDb();
  return db
    .prepare<[number, string], Topic>("SELECT * FROM topics WHERE chat_id = ? AND phrase = ? COLLATE NOCASE")
    .get(chatId, phrase);
}

export function getAllTopics(): Topic[] {
  const db: Database.Database = getDb();
  return db.prepare<[], Topic>("SELECT * FROM topics").all();
}

export function getTopicsByChatIds(chatIds: number[]): Topic[] {
  const db: Database.Database = getDb();

  if (chatIds.length === 0) return [];

  const placeholders: string = chatIds.map(() => "?").join(",");

  return db.prepare<number[], Topic>(`SELECT * FROM topics WHERE chat_id IN (${placeholders})`).all(...chatIds);
}
