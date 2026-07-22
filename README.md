# NewsBot

A Telegram bot that polls RSS feeds, filters articles by topic using an LLM classifier, and notifies chats when a match is found.

## How it works

- **Feeds are global.** Anyone (admin) adds a feed once and it's polled for everyone.
- **Topics are per-chat.** Each chat (a private DM or a group) sets its own topics, and only sees matches for its own topics — completely independent of which feed the article came from.
- Every cycle: fetch all feeds → classify newly-fetched articles against every chat's topics → send one notification.
- Classification is done by calling an [opencode](https://opencode.ai) server as an LLM classifier (no tools, a fixed system prompt, one throwaway session per call).
- Notifications are throttled to **one message per chat per cycle** — the rest stay queued and go out on subsequent cycles, oldest first.
- If an article has an image (from RSS `media:content`/`media:thumbnail`, an image enclosure, or an `<img>` in the content), the notification is sent as a photo with a caption; otherwise as plain text.

## Requirements

- Node.js >= 22
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- An opencode server reachable over HTTP (`opencode serve`), with a provider/model configured (e.g. the `opencode-go` OpenCode Zen provider and `deepseek-v4-flash`)

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill it in:
   ```
   TELEGRAM_BOT_TOKEN=       # from @BotFather
   OPENCODE_SERVER_URL=      # e.g. http://localhost:4096
   OPENCODE_PROVIDER_ID=     # e.g. opencode-go
   OPENCODE_MODEL_ID=        # e.g. deepseek-v4-flash
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

`docker-compose.yml` runs just the bot container (no opencode sidecar) and points `OPENCODE_SERVER_URL` at `http://host.docker.internal:4096`, i.e. it expects opencode to already be running on the host. Adjust that URL/port if your opencode server lives elsewhere.

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

Set `LOG_LEVEL=debug` in `.env` for verbose per-article/per-request logs (opencode session creation, individual classification results, etc.). Default level is `info`. Logs go to both stdout and `<DATABASE_PATH's directory>/newsbot.log`.
