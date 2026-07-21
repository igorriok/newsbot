import Database from "better-sqlite3";
import { config } from "../config";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.DATABASE_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}
