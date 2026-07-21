# Telegram RSS News Bot — Implementation Plan

**Filtering engine:** opencode server (`opencode serve`), driven via its HTTP API / `@opencode-ai/sdk`, used as an LLM classifier rather than a coding agent.

## Architecture

```
Telegram ⇄ Bot (grammY/TS)
                │
     ┌──────────┼──────────────┐
     │          │              │
  SQLite    RSS Poller    Classifier
  (state)   (cron loop)   (opencode client)
                │              │
           rss-parser    opencode server
                              (HTTP API, no
                               file/shell tools)
```

**Stack default:** Node.js + TypeScript, since opencode ships an official TS SDK (`@opencode-ai/sdk`) — cleanest integration path. Could alternatively be done in Python + raw HTTP calls to the opencode REST API.

## Data model (SQLite)

- `users(id, telegram_id, created_at)`
- `feeds(id, url, title, last_fetched_at, etag, last_modified, healthy)`
- `subscriptions(user_id, feed_id)` — many-to-many
- `topics(id, user_id, phrase, created_at)`
- `articles(id, feed_id, guid, url, title, summary, published_at, fetched_at)`
- `article_topic_matches(article_id, topic_id, matched, score, reasoning, checked_at)` — cache so the same article/topic pair is never re-classified, and so notifications aren't duplicated

## Bot commands

- `/start`, `/help`
- `/addfeed <url>`, `/removefeed <id>`, `/listfeeds`
- `/addtopic <phrase>`, `/removetopic <id>`, `/listtopics`

## Phases

**0 — Scaffolding**
Node/TS project; deps: `grammy`, `rss-parser`, `better-sqlite3` (or `drizzle-orm`), `@opencode-ai/sdk`, `node-cron`, `zod`, `dotenv`. `.env` for `TELEGRAM_BOT_TOKEN`, `OPENCODE_SERVER_URL`, `DATABASE_PATH`.

**1 — Bot skeleton**
Command handlers, user upsert middleware.

**2 — Persistence layer**
Schema + migrations, CRUD helpers for feeds/topics/subscriptions.

**3 — RSS polling engine**
Cron loop over *distinct feed URLs* (not per-subscription, to avoid duplicate fetches). Fetch+parse with `rss-parser`, use ETag/Last-Modified for cheap polling, diff against stored GUIDs, insert new articles only. Backoff on feed errors.

**4 — opencode classifier integration** (the core novel piece)
- Run `opencode serve` as a sidecar process (Docker Compose service or child process managed by the bot).
- Define a dedicated **classifier agent/mode** in opencode's config with **no file/shell/edit tools** — it must behave as a pure text-in/JSON-out classifier, not a coding agent poking at a repo.
- Prompt template: article title + summary + the user's topic list → ask for strict JSON `{matches: [{topic_id, relevant: bool, score, reason}]}`.
- Parse/validate response with `zod`; retry once on malformed JSON.
- Batch smartly: classify once per **article** against **all its subscribers' topics in one prompt** (topics dedup naturally — many users share phrasing), not once per user.
- Cache every result in `article_topic_matches` so nothing is classified twice.

**5 — Notification dispatcher**
After each poll cycle, pull unnotified matches, group by user, send Telegram messages respecting rate limits (~1 msg/sec/chat), mark as sent.

**6 — Reliability & ops**
Structured logging, retries/backoff for both RSS fetch and opencode calls, graceful shutdown, Dockerfile + docker-compose (bot + opencode server), tests for dedup logic and classifier response parsing.

**7 — Deployment**
Long-polling (simplest, no public URL needed) via pm2/systemd or Docker Compose with restart policy on a small VPS/Fly.io box.

## Risks / open questions to resolve before Phase 4

1. **opencode as classifier is off-label use** — it's built as a coding agent, so the "no tools" agent config is load-bearing; without it, sessions may try to explore a filesystem or shell out. Verify this against the currently installed opencode version's config schema before building the integration.
2. **Cost/latency** — an LLM call per new article is much pricier than keyword matching. Consider a cheap pre-filter (substring/keyword match) to skip obviously-irrelevant articles before invoking opencode, or lean on the per-article batching in Phase 4 to keep call volume down.
3. **Colocated vs. standalone opencode server** — decide whether the bot spawns/owns the opencode process or connects to one running independently; affects the Docker Compose layout in Phase 6.
