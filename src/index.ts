import { runMigrations } from "./db/schema";
import { bot, registerCommands } from "./bot";
import { pollCycle } from "./jobs/cycle";
import { log } from "./utils/log";
import { config } from "./config";
import cron from "node-cron";

async function main(): Promise<void> {
  runMigrations();
  log("info", "Database migrations complete");

  bot.catch((err) => {
    log("error", `Bot error: ${err.message}`);
  });

  await registerCommands();
  log("info", "Registered bot commands with Telegram");

  bot
    .start({
      onStart: () => {
        log("info", "Bot started, polling for updates...");
      },
    })
    .catch((err: any) => {
      log("error", `Bot failed to start: ${err.message}`);
      process.exit(1);
    });

  cron.schedule(config.POLL_CRON_SCHEDULE, () => {
    pollCycle().catch((err) => log("error", `Poll cycle failed: ${err.message}`));
  });

  await pollCycle();

  const shutdown = async () => {
    log("info", "Shutting down...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("error", `Fatal: ${err.message}`);
  process.exit(1);
});
