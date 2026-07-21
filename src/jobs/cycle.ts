import { pollOnce } from "../rss/poller";
import { classifyArticle } from "../classifier/client";
import { dispatchNotifications } from "../notifications/dispatcher";
import { getUncheckedArticles } from "../db/articles";
import { getAllTopics } from "../db/topics";
import { upsertMatch } from "../db/article_topic_matches";
import { log } from "../utils/log";

let running = false;

async function runClassificationCycle(): Promise<void> {
  const articles = getUncheckedArticles();
  if (articles.length === 0) return;

  const topics = getAllTopics().map((t) => ({ id: t.id, phrase: t.phrase }));
  if (topics.length === 0) return;
  const topicIds = new Set(topics.map((t) => t.id));

  log("info", `Classifying ${articles.length} articles against ${topics.length} topics`);

  const classifyOne = async (article: typeof articles[number]) => {
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

    const relevantCount = result.filter((r) => r.relevant).length;
    log("debug", `Article ${article.id}: ${relevantCount}/${result.length} topic matches relevant`);

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

export function isCycleRunning(): boolean {
  return running;
}

export async function pollCycle(): Promise<void> {
  if (running) {
    log("warn", "Previous poll cycle still running, skipping");
    return;
  }
  running = true;
  log("info", "Poll cycle starting");
  try {
    await pollOnce();
    await runClassificationCycle();
    await dispatchNotifications();
    log("info", "Poll cycle finished");
  } finally {
    running = false;
  }
}
