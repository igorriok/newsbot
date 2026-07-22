import fs from "fs";
import path from "path";
import { config } from "../config";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: Level = (process.env.LOG_LEVEL as Level) ?? "info";

const logDir = path.dirname(config.DATABASE_PATH);
const logFilePath = path.join(logDir, "newsbot.log");

fs.mkdirSync(logDir, { recursive: true });

export function log(level: Level, message: string): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${message}`;

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }

  try {
    fs.appendFileSync(logFilePath, line + "\n");
  } catch {
    // best-effort file logging; console output above already captured it
  }
}
