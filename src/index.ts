import { runMigrations } from "./db/schema";
import { bot } from "./bot";
import { pollOnce } from "./rss/poller";
import { classifyArticle } from "./classifier/client";
import { dispatchNotifications } from "./notifications/dispatcher";
import { getUncheckedArticles } from "./db/articles";
import { getTopicsByUserIds } from "./db/topics";
import { upsertMatch } from "./db/article_topic_matches";
import { getSubscribersForFeed } from "./db/subscriptions";
import { log } from "./utils/log";
import cron from "node-cron";

let running = false;

async function runClassificationCycle(): Promise<void> {
  const articles = getUncheckedArticles();
  if (articles.length === 0) return;

  const byFeed = new Map<number, typeof articles>();
  for (const a of articles) {
    if (!byFeed.has(a.feed_id)) byFeed.set(a.feed_id, []);
    byFeed.get(a.feed_id)!.push(a);
  }

  const feedTopics = new Map<number, { id: number; phrase: string }[]>();
  for (const [feedId] of byFeed) {
    const userIds = getSubscribersForFeed(feedId);
    const topics = getTopicsByUserIds(userIds);
    feedTopics.set(feedId, topics.map((t) => ({ id: t.id, phrase: t.phrase })));
  }

  const allTopics = [...feedTopics.values()].flat();
  if (allTopics.length === 0) return;
  log("info", `Classifying ${articles.length} articles against ${allTopics.length} scoped topics`);

  const classifyOne = async (article: typeof articles[number]) => {
    const topics = feedTopics.get(article.feed_id);
    if (!topics || topics.length === 0) return;
    const topicIds = new Set(topics.map((t) => t.id));

    const result = await classifyArticle(
      article.id,
      article.title ?? "Untitled",
      article.summary,
      topics,
    );

    if (!result) {
      log("warn", `Classification failed for article ${article.id}, skipping`);
      return;
    }

    for (const r of result) {
      if (!topicIds.has(r.topic_id)) {
        log("warn", `Classifier returned unknown topic_id ${r.topic_id} for article ${article.id}, skipping`);
        continue;
      }
      try {
        upsertMatch(article.id, r.topic_id, r.relevant, r.score, r.reason);
      } catch (err: any) {
        log("error", `Failed to upsert match for article ${article.id}, topic ${r.topic_id}: ${err.message}`);
      }
    }
  };

  const concurrencyLimit = 5;
  for (let i = 0; i < articles.length; i += concurrencyLimit) {
    const batch = articles.slice(i, i + concurrencyLimit);
    await Promise.all(batch.map(classifyOne));
  }
}

async function pollCycle(): Promise<void> {
  if (running) {
    log("warn", "Previous poll cycle still running, skipping");
    return;
  }
  running = true;
  try {
    await pollOnce();
    await runClassificationCycle();
    await dispatchNotifications();
  } finally {
    running = false;
  }
}

async function main(): Promise<void> {
  runMigrations();
  log("info", "Database migrations complete");

  bot.catch((err) => {
    log("error", `Bot error: ${err.message}`);
  });

  bot.start({
    onStart: () => {
      log("info", "Bot started, polling for updates...");
    },
  }).catch((err: any) => {
    log("error", `Bot failed to start: ${err.message}`);
    process.exit(1);
  });

  cron.schedule("*/10 * * * *", () => {
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
