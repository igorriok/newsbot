# Cover newsbot with tests

## Context

The project currently has zero automated tests — only `tsc --noEmit`. This became concrete risk in practice: the same article was sent twice because two RSS feeds from the same site carried the same story and `articles` was only deduped per-feed. A test suite over the DB/business-logic layer would have caught that class of bug directly and will catch regressions in it going forward.

Scope for this pass: DB layer, RSS parsing helpers, classifier response parsing, and notification dispatch/orchestration. Bot command handlers (`src/bot/index.ts`) and CI wiring are explicitly deferred to a later pass.

## Test infrastructure

- **Runner**: Node's built-in test runner (`node:test` + `node:assert/strict`), invoked via `tsx --test` — no new dependencies, since `tsx` is already a devDependency and supports TypeScript directly.
- **npm script** in `package.json`: `"test": "tsx --test tests/**/*.test.ts"`.
- **Layout**: new `tests/` directory at repo root, mirroring `src/`:
  - `tests/helpers/db.ts` — test helper (see below)
  - `tests/db/schema.test.ts`, `tests/db/articles.test.ts`, `tests/db/article_topic_matches.test.ts`, `tests/db/chats.test.ts`, `tests/db/topics.test.ts`, `tests/db/feeds.test.ts`
  - `tests/rss/poller.test.ts`
  - `tests/classifier/client.test.ts`
  - `tests/notifications/dispatcher.test.ts`
  - `tests/jobs/cycle.test.ts`

### DB test isolation seam

`src/db/connection.ts` currently caches a single module-level `db` singleton built from `config.DATABASE_PATH` on first call to `getDb()`. Tests need a fresh, isolated SQLite file per test (so tests can't see each other's rows and don't touch `data/newsbot.db`). Add a small, explicitly-test-only seam:

```ts
export function resetDbForTests(path: string): void {
  if (db) db.close();
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}
```

`tests/helpers/db.ts` wraps this: creates a temp file path (via `node:fs` + `node:os.tmpdir()`), calls `resetDbForTests(path)`, then `runMigrations()` from `src/db/schema.ts`, and returns a cleanup function that closes the db and unlinks the temp file. Each test file's `beforeEach`/`afterEach` (from `node:test`) uses this to get a clean DB per test case.

## Coverage by layer

### 1. Pure functions (no DB, no network)
- **`src/rss/poller.ts`**: export `sanitizeImageUrl` and `extractImageUrl` (currently unexported internals) for direct testing. Cover: domain-duplicated path collapsing, media:content / media:thumbnail / enclosure / inline `<img>` extraction precedence, and the no-image case.
- **`src/classifier/client.ts`**: export `parseResponse` for direct testing. Cover: valid JSON, JSON wrapped in ```` ```json ```` fences, malformed JSON, a match scoring below `config.MIN_RELEVANCE_SCORE` being forced to `relevant: false`, and the score-defaulting behavior when `score` is omitted (0.8 if relevant, 0.0 if not).

### 2. DB layer (real better-sqlite3 against a temp file, via the helper above)
- **`schema.test.ts`**: `runMigrations()` is idempotent (safe to call twice); the URL-dedup migration merges pre-existing duplicate-URL rows (keeps lowest id, folds in `image_url` from the duplicate, cascades away the duplicate's `article_topic_matches`) and the resulting `idx_articles_url` unique index rejects a second insert with a duplicate URL.
- **`articles.test.ts`** (this is where the regression lives): `insertArticle` inserts a new row and returns it; inserting the same `(feed_id, guid)` again returns `null` and backfills `image_url` if the existing row lacks one; inserting a *different* `(feed_id, guid)` but the **same `url`** (the actual bug scenario — two feeds, same story) returns `null`, does not create a second row, and still backfills the image onto the original. Also cover `getUncheckedArticles`, `getArticlesUncheckedForTopic`, `getArticlesMissingImage` filtering.
- **`article_topic_matches.test.ts`**: `upsertMatch` insert-then-update-on-conflict semantics; `getUnnotifiedMatches` only returns `matched=1 AND notified=0`, joined correctly to article/topic/chat, ordered oldest-first; `markNotified` flips the flag for the right `(article_id, topic_id)` pair only.
- **`chats.test.ts`**: `upsertChat` is idempotent (second call with same telegram id returns the same row, no duplicate insert).
- **`topics.test.ts`**: CRUD + `getTopicByChatAndPhrase` case-insensitivity (`COLLATE NOCASE`) + `getTopicsByChatIds` with empty array returns `[]` without querying.
- **`feeds.test.ts`**: `updateFeedMeta` partial updates (only touches provided fields), `getAllDistinctFeedUrls` shape.

### 3. Business logic with mocked externals (`node:test`'s built-in `mock` — `mock.method`, `t.mock.fn()`)
- **`dispatcher.test.ts`**: stub `bot.api.sendMessage` / `bot.api.sendPhoto` (imported from `src/bot`). Cover: throttling to at most one send per chat per cycle even when a chat has multiple unnotified matches (oldest `checked_at` wins, rest stay unnotified for next cycle); a match whose `chat_id` no longer resolves to a row gets marked notified and skipped without sending; `sendPhoto` failure falls back to `sendMessage`.
- **`client.test.ts`** (classifier): stub `global.fetch` to simulate the OpenCode HTTP flow — session create → message send → parse; non-OK response at each step returns `null`; a parse failure on the first response triggers exactly one retry; the session-delete cleanup call always fires (including on error paths).
- **`poller.test.ts`**: stub `global.fetch` for feed XML. Cover: a 304 response leaves `etag`/`last_modified` untouched and inserts nothing; a normal 200 response inserts new articles and marks the feed healthy; a fetch failure marks the feed unhealthy and doesn't throw.

### 4. Orchestration
- **`cycle.test.ts`**: `pollCycle()` guards against re-entrancy — starting a second call while one is in-flight logs a skip and does not run twice (drive this by mocking `pollOnce` to return a controllable pending promise). `classifyBacklogForNewTopic` only classifies articles unchecked *for that specific topic* and calls `dispatchNotifications` afterward.

## Verification

- `npm test` runs the full suite via `tsx --test tests/**/*.test.ts` and should pass cleanly.
- `npm run typecheck` (already exists) continues to pass — the new `resetDbForTests` export and the two newly-exported pure functions must be properly typed.
- Spot-check that tests never touch `data/newsbot.db` (all DB tests go through the temp-file helper) and clean up their temp files even on failure (`afterEach`, not just end-of-file).
