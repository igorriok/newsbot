import fs from "fs";
import path from "path";
import * as nodeOs from "os";
import { resetDbForTests, getDb } from "../../src/db/connection";
import { runMigrations } from "../../src/db/schema";

export function setupTestDb(): () => void {
  const tmpFile: string = path.join(
    nodeOs.tmpdir(),
    `newsbot-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  resetDbForTests(tmpFile);
  runMigrations();

  return () => {
    try {
      getDb().close();
    } catch {
      // ignore close error
    }

    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore unlink error
    }
  };
}
