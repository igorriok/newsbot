import { getDb } from "./connection";

export interface Topic {
  id: number;
  chat_id: number;
  phrase: string;
  created_at: string;
}

export function insertTopic(chatId: number, phrase: string): Topic {
  const db = getDb();
  const info = db.prepare("INSERT INTO topics (chat_id, phrase) VALUES (?, ?)").run(chatId, phrase);
  return { id: info.lastInsertRowid as number, chat_id: chatId, phrase, created_at: new Date().toISOString() };
}

export function deleteTopic(id: number, chatId: number): boolean {
  const db = getDb();
  const info = db.prepare("DELETE FROM topics WHERE id = ? AND chat_id = ?").run(id, chatId);
  return info.changes > 0;
}

export function getTopicsForChat(chatId: number): Topic[] {
  const db = getDb();
  return db.prepare("SELECT * FROM topics WHERE chat_id = ?").all(chatId) as Topic[];
}

export function getAllTopics(): Topic[] {
  const db = getDb();
  return db.prepare("SELECT * FROM topics").all() as Topic[];
}

export function getTopicsByChatIds(chatIds: number[]): Topic[] {
  const db = getDb();
  if (chatIds.length === 0) return [];
  const placeholders = chatIds.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM topics WHERE chat_id IN (${placeholders})`).all(...chatIds) as Topic[];
}
