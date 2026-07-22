import { pollOnce } from "../rss/poller";
import { classifyArticle } from "../classifier/client";
import { dispatchNotifications } from "../notifications/dispatcher";
import { Article, getUncheckedArticles, getArticlesUncheckedForTopic } from "../db/articles";
import { getAllTopics, Topic } from "../db/topics";
import { upsertMatch } from "../db/article_topic_matches";
import { log } from "../utils/log";

interface TopicInfo {
  id: number;
  phrase: string;
}

let running: boolean = false;

async function classifyArticlesAgainstTopics(
  articles: Article[],
  topics: TopicInfo[],
): Promise<void> {
  if (articles.length === 0 || topics.length === 0) return;
  const topicIds: Set<number> = new Set(topics.map((topic) => topic.id));

  const classifyOne: (article: Article) => Promise<void> = async (article: Article) => {
    const result: Awaited<ReturnType<typeof classifyArticle>> = await classifyArticle(
      article.id,
      article.title ?? "Untitled",
      article.summary,
      topics,
    );

    if (!result) {
      log("warn", `Classification failed for article ${article.id}, skipping`);
      return;
    }

    const relevantCount: number = result.filter((match) => match.relevant).length;

    log("debug", `Article ${article.id}: ${relevantCount}/${result.length} topic matches relevant`);

    for (const match of result) {
      if (!topicIds.has(match.topic_id)) {
        log("warn", `Classifier returned unknown topic_id ${match.topic_id} for article ${article.id}, skipping`);
        continue;
      }

      try {
        upsertMatch(article.id, match.topic_id, match.relevant, match.score, match.reason);
      } catch (err: unknown) {
        log(
          "error",
          `Failed to upsert match for article ${article.id}, topic ${match.topic_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  const concurrencyLimit: number = 5;

  for (let index: number = 0; index < articles.length; index += concurrencyLimit) {
    const batch: Article[] = articles.slice(index, index + concurrencyLimit);

    await Promise.all(batch.map(classifyOne));
  }
}

async function runClassificationCycle(): Promise<void> {
  const articles: Article[] = getUncheckedArticles();
  if (articles.length === 0) return;

  const topics: TopicInfo[] = getAllTopics().map((topic) => ({
    id: topic.id,
    phrase: topic.phrase,
  }));
  if (topics.length === 0) return;

  log("info", `Classifying ${articles.length} articles against ${topics.length} topics`);
  await classifyArticlesAgainstTopics(articles, topics);
}

export async function classifyBacklogForNewTopic(topic: Topic): Promise<void> {
  const articles: Article[] = getArticlesUncheckedForTopic(topic.id);
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
