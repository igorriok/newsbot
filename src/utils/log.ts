import fs from "fs";
import path from "path";
import { config } from "../config";

const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
type Level = keyof typeof LEVELS;

function resolveLogLevel(): Level {
  if (process.env.LOG_LEVEL === "debug") return "debug";
  if (process.env.LOG_LEVEL === "warn") return "warn";
  if (process.env.LOG_LEVEL === "error") return "error";
  return "info";
}

const currentLevel: Level = resolveLogLevel();

const logDir: string = path.dirname(config.DATABASE_PATH);
const logFilePath: string = path.join(logDir, "newsbot.log");

fs.mkdirSync(logDir, { recursive: true });

export function log(level: Level, message: string): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const timestamp: string = new Date().toISOString();
  const line: string = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

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
