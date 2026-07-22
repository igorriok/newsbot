import fs from "fs";
import path from "path";
import os from "os";
import { resetDbForTests, getDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/schema";

export function setupTestDb(): () => void {
  const tmpFile = path.join(os.tmpdir(), `newsbot-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

  resetDbForTests(tmpFile);
  runMigrations();

  return () => {
    try {
      getDb().close();
    } catch {}

    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  };
}
