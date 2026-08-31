// One-time backlog sweep for the one-notification-per-topic-per-day rule.
//
// Before the dispatcher started retiring daily-limited matches, a topic that matched
// several articles a day accumulated a queue: it drained at one article per day, so a
// busy topic's notifications ran days behind the news. This retires every match still
// pending from a day before today, leaving today's queue to dispatch normally.
//
// notified_at is backdated to checked_at rather than set to now, so a swept row does
// not count as "notified today" and block a genuinely new article for that topic.
//
// Dry run by default; pass --apply to write.
import Database from "better-sqlite3";
import { config } from "../src/config";

interface StaleRow {
  article_id: number;
  topic_id: number;
  phrase: string | null;
  chat_id: number | null;
  day: string;
  title: string | null;
}

const apply: boolean = process.argv.includes("--apply");
const db: Database.Database = new Database(config.DATABASE_PATH);

db.pragma("journal_mode = WAL");

const WHERE: string = "matched = 1 AND notified = 0 AND date(checked_at) < date('now')";

const rows: StaleRow[] = db
  .prepare<[], StaleRow>(
    `
  SELECT m.article_id, m.topic_id, t.phrase, t.chat_id, date(m.checked_at) AS day, a.title
  FROM article_topic_matches m
  LEFT JOIN topics t ON t.id = m.topic_id
  LEFT JOIN articles a ON a.id = m.article_id
  WHERE ${WHERE.replace(/\b(matched|notified|checked_at)\b/g, "m.$1")}
  ORDER BY t.chat_id, m.topic_id, m.checked_at
`,
  )
  .all();

for (const row of rows) {
  const topic: string = row.phrase ?? `<deleted topic ${row.topic_id}>`;

  console.log(`${row.day}  chat ${row.chat_id ?? "?"}  ${topic}  ${(row.title ?? "<no title>").slice(0, 60)}`);
}

if (!apply) {
  console.log(`\n${rows.length} stale match(es) would be retired. Re-run with --apply to write.`);
  process.exit(0);
}

const result: Database.RunResult = db
  .prepare(`UPDATE article_topic_matches SET notified = 1, notified_at = checked_at WHERE ${WHERE}`)
  .run();

console.log(`\nRetired ${result.changes} stale match(es).`);
