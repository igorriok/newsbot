import { pollOnce } from "../rss/poller";
import { classifyArticle, ClassifyResult } from "../classifier/client";
import { dispatchNotifications } from "../notifications/dispatcher";
import { Article, getUncheckedArticles } from "../db/articles";
import { getAllTopics } from "../db/topics";
import { upsertMatch } from "../db/article_topic_matches";
import { log } from "../utils/log";

interface TopicInfo {
  id: number;
  phrase: string;
}

let running: boolean = false;

const CLASSIFICATION_CONCURRENCY: number = 5;

async function classifyArticlesAgainstTopics(articles: Article[], topics: TopicInfo[]): Promise<void> {
  if (articles.length === 0 || topics.length === 0) return;
  const topicIds: Set<number> = new Set(topics.map((topic) => topic.id));

  const classifyOne: (article: Article) => Promise<void> = async (article: Article) => {
    const result: ClassifyResult[] | null = await classifyArticle(
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
        const msg: string = err instanceof Error ? err.message : String(err);
        const isForeignKey: boolean =
          typeof err === "object" && err !== null && "code" in err && err.code === "SQLITE_CONSTRAINT_FOREIGNKEY";

        if (isForeignKey) {
          // The topic or article was deleted across an await boundary between the
          // classifier round-trip and this INSERT. This catch is the sole guard for
          // that race — never rethrow, never ERROR, never retry the LLM call. Warn
          // keeps the skip visible at the default log level without ERROR spam.
          log("warn", `FK constraint on upsert for article ${article.id}, topic ${match.topic_id}: ${msg}`);
          continue;
        }

        log("error", `Failed to upsert match for article ${article.id}, topic ${match.topic_id}: ${msg}`);
      }
    }
  };

  for (let index: number = 0; index < articles.length; index += CLASSIFICATION_CONCURRENCY) {
    const batch: Article[] = articles.slice(index, index + CLASSIFICATION_CONCURRENCY);

    await Promise.all(batch.map(classifyOne));
  }
}

export async function runClassificationCycle(): Promise<void> {
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

// A new topic deliberately has no backfill: it applies to articles fetched from
// the moment it was added onwards. The poll cycle classifies every newly fetched
// article against all current topics, so a topic added now starts matching on the
// next cycle without a sweep of the archive — which cost one API call per existing
// article, per topic added.

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
