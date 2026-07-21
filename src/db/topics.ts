import { getDb } from "./connection";

export interface Topic {
  id: number;
  user_id: number;
  phrase: string;
  created_at: string;
}

export function insertTopic(userId: number, phrase: string): Topic {
  const db = getDb();
  const info = db.prepare("INSERT INTO topics (user_id, phrase) VALUES (?, ?)").run(userId, phrase);
  return { id: info.lastInsertRowid as number, user_id: userId, phrase, created_at: new Date().toISOString() };
}

export function deleteTopic(id: number, userId: number): boolean {
  const db = getDb();
  const info = db.prepare("DELETE FROM topics WHERE id = ? AND user_id = ?").run(id, userId);
  return info.changes > 0;
}

export function getTopicsForUser(userId: number): Topic[] {
  const db = getDb();
  return db.prepare("SELECT * FROM topics WHERE user_id = ?").all(userId) as Topic[];
}

export function getAllTopics(): Topic[] {
  const db = getDb();
  return db.prepare("SELECT * FROM topics").all() as Topic[];
}

export function getTopicsByUserIds(userIds: number[]): Topic[] {
  const db = getDb();
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM topics WHERE user_id IN (${placeholders})`).all(...userIds) as Topic[];
}
