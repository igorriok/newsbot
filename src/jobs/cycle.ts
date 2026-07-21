import { pollOnce } from "../rss/poller";
import { classifyArticle } from "../classifier/client";
import { dispatchNotifications } from "../notifications/dispatcher";
import { Article, getUncheckedArticles, getArticlesUncheckedForTopic } from "../db/articles";
import { getAllTopics, Topic } from "../db/topics";
import { upsertMatch } from "../db/article_topic_matches";
import { log } from "../utils/log";

let running = false;

async function classifyArticlesAgainstTopics(articles: Article[], topics: { id: number; phrase: string }[]): Promise<void> {
  if (articles.length === 0 || topics.length === 0) return;
  const topicIds = new Set(topics.map((t) => t.id));

  const classifyOne = async (article: Article) => {
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

async function runClassificationCycle(): Promise<void> {
  const articles = getUncheckedArticles();
  if (articles.length === 0) return;

  const topics = getAllTopics().map((t) => ({ id: t.id, phrase: t.phrase }));
  if (topics.length === 0) return;

  log("info", `Classifying ${articles.length} articles against ${topics.length} topics`);
  await classifyArticlesAgainstTopics(articles, topics);
}

export async function classifyBacklogForNewTopic(topic: Topic): Promise<void> {
  const articles = getArticlesUncheckedForTopic(topic.id);
  if (articles.length === 0) return;

  log("info", `Backfilling ${articles.length} existing articles against new topic "${topic.phrase}" (id ${topic.id})`);
  await classifyArticlesAgainstTopics(articles, [{ id: topic.id, phrase: topic.phrase }]);
  await dispatchNotifications();
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
