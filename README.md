# NewsBot

A Telegram bot that polls RSS feeds, filters articles by topic using an LLM classifier, and notifies chats when a match is found.

## How it works

- **Feeds are global.** Anyone (admin) adds a feed once and it's polled for everyone.
- **Topics are per-chat.** Each chat (a private DM or a group) sets its own topics, and only sees matches for its own topics — completely independent of which feed the article came from.
- Every cycle: fetch all feeds → classify newly-fetched articles against every chat's topics → send one notification.
- Classification is done by calling the DeepSeek API (OpenAI-compatible chat completions) with a fixed system prompt, requesting strict JSON (one request per article per retry).
- Notifications are throttled to **one message per chat per cycle** — the rest stay queued and go out on subsequent cycles, oldest first.
- If an article has an image (from RSS `media:content`/`media:thumbnail`, an image enclosure, or an `<img>` in the content), the notification is sent as a photo with a caption; otherwise as plain text.

## Requirements

- Node.js >= 22
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- A DeepSeek API key with chat completions access (e.g. for the `deepseek-v4-flash` model)

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill it in:
   ```
   TELEGRAM_BOT_TOKEN=       # from @BotFather
   DEEPSEEK_API_KEY=         # your DeepSeek API key (chat completions access)
   DEEPSEEK_MODEL_ID=        # e.g. deepseek-v4-flash
   # DEEPSEEK_BASE_URL=      # e.g. https://api.deepseek.com (default)
   DATABASE_PATH=            # e.g. ./data/newsbot.db
   ADMIN_TELEGRAM_IDS=       # comma-separated Telegram user IDs allowed to use the bot
   POLL_CRON_SCHEDULE=       # e.g. */10 * * * * (every 10 minutes)
   ```
   Get your own Telegram ID from [@userinfobot](https://t.me/userinfobot).
3. Run it:
   ```
   npm run dev      # local dev, auto-reload
   npm run build && npm start   # production build
   ```

Only Telegram user IDs listed in `ADMIN_TELEGRAM_IDS` can use any bot command — everyone else gets "You are not authorized to use this bot." If the list is empty, nobody is authorized (fails closed).

## Running with Docker

```
docker compose up --build -d
```

`docker-compose.yml` runs just the bot container — no host networking and no local servers are required. The DeepSeek API key and model come from `.env` (bind-mounted in via `env_file`).

Both the SQLite database and a rolling log file (`newsbot.log`) live under `./data`, which is bind-mounted into the container — so both survive container rebuilds/recreation.

## Bot commands

| Command              | Scope     | Description                                                                       |
| -------------------- | --------- | --------------------------------------------------------------------------------- |
| `/start`, `/help`    | —         | Show the command list                                                             |
| `/addfeed <url>`     | global    | Add an RSS feed (affects every chat)                                              |
| `/removefeed <id>`   | global    | Remove a feed by id                                                               |
| `/listfeeds`         | global    | List all feeds (⚠️ marks ones currently failing to fetch)                         |
| `/addtopic <phrase>` | this chat | Track a topic — only this chat gets matched against it                            |
| `/removetopic <id>`  | this chat | Remove a topic by id                                                              |
| `/listtopics`        | this chat | List this chat's topics                                                           |
| `/checkfeeds`        | —         | Manually trigger a feed check right now, instead of waiting for the cron schedule |

If a URL is submitted to `/addfeed` without `http(s)://`, it's assumed to be `https://`.

## Logs

Set `LOG_LEVEL=debug` in `.env` for verbose per-article/per-request logs (individual classification requests, token usage, etc.). Default level is `info`. Logs go to both stdout and `<DATABASE_PATH's directory>/newsbot.log`.
