import Parser from "rss-parser";
import { getAllDistinctFeedUrls, getFeedById, updateFeedMeta } from "../db/feeds";
import { insertArticle, updateArticleImage, getArticleByGuid, markImageChecked, getArticlesMissingImage } from "../db/articles";
import { log } from "../utils/log";

const parser = new Parser({
  headers: { "User-Agent": "NewsBot/1.0" },
  timeout: 15000,
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

interface FetchResult {
  articles: { guid: string; url?: string; title?: string; summary?: string; published_at?: string; image_url?: string }[];
  etag?: string;
  lastModified?: string;
  title?: string;
}

function extractImageUrl(item: any): string | undefined {
  const mediaContentUrl = item.mediaContent?.$?.url;
  if (mediaContentUrl) return mediaContentUrl;

  const mediaThumbnailUrl = item.mediaThumbnail?.$?.url;
  if (mediaThumbnailUrl) return mediaThumbnailUrl;

  if (item.enclosure?.url && item.enclosure.type?.startsWith("image/")) {
    return item.enclosure.url;
  }

  const html: string | undefined = item.content ?? item["content:encoded"];
  const match = html?.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1];
}

async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "NewsBot/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return undefined;

    const html = await response.text();
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return match?.[1];
  } catch (err: any) {
    log("debug", `Failed to fetch og:image from ${url}: ${err.message}`);
    return undefined;
  }
}

async function fetchFeed(url: string, etag?: string | null, lastModified?: string | null): Promise<FetchResult | null> {
  log("debug", `Fetching feed: ${url}`);
  try {
    const headers: Record<string, string> = { "User-Agent": "NewsBot/1.0" };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (response.status === 304) {
      log("info", `Feed not modified (304): ${url}`);
      return { articles: [], etag: etag ?? undefined, lastModified: lastModified ?? undefined };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);

    log("info", `Fetched feed ${url}: HTTP ${response.status}, ${feed.items.length} items in response`);

    return {
      articles: feed.items.map((item) => ({
        guid: item.guid ?? item.link ?? item.title ?? "",
        url: item.link,
        title: item.title,
        summary: item.contentSnippet ?? item.content ?? item.summary,
        published_at: item.pubDate ?? item.isoDate ?? undefined,
        image_url: extractImageUrl(item),
      })),
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      title: feed.title?.trim() ?? feed.description?.trim() ?? url,
    };
  } catch (err: any) {
    const cause = err.cause ? ` (cause: ${err.cause.message ?? err.cause})` : "";
    log("error", `Failed to fetch feed ${url}: ${err.message}${cause}`);
    return null;
  }
}

async function backfillMissingImages(): Promise<void> {
  const articles = getArticlesMissingImage(30);
  if (articles.length === 0) return;

  log("info", `Backfilling og:image for ${articles.length} existing articles missing an image`);
  for (const article of articles) {
    const ogImage = article.url ? await fetchOgImage(article.url) : undefined;
    if (ogImage) {
      updateArticleImage(article.id, ogImage);
      log("debug", `Backfilled og:image for article ${article.id}: ${ogImage}`);
    } else {
      markImageChecked(article.id);
    }
  }
}

export async function pollOnce(): Promise<void> {
  const feeds = getAllDistinctFeedUrls();
  if (feeds.length === 0) return;

  log("info", `Polling ${feeds.length} feeds...`);

  let totalNewArticles = 0;

  for (const feed of feeds) {
    try {
      const meta = getFeedById(feed.id);
      const result = await fetchFeed(feed.url, meta?.etag, meta?.last_modified);
      if (!result) {
        updateFeedMeta(feed.id, { healthy: 0 });
        continue;
      }

      updateFeedMeta(feed.id, {
        title: result.title,
        last_fetched_at: new Date().toISOString(),
        etag: result.etag ?? null,
        last_modified: result.lastModified ?? null,
        healthy: 1,
      });

      if (result.articles.length === 0) continue;

      let newCount = 0;
      for (const item of result.articles) {
        if (!item.guid) continue;
        const inserted = insertArticle(feed.id, item.guid, {
          url: item.url,
          title: item.title,
          summary: item.summary,
          published_at: item.published_at,
          image_url: item.image_url,
        });
        if (inserted) newCount++;

        const current = inserted ?? getArticleByGuid(feed.id, item.guid);
        if (current && !current.image_url && !current.image_checked && item.url) {
          const ogImage = await fetchOgImage(item.url);
          if (ogImage) {
            updateArticleImage(current.id, ogImage);
            log("debug", `Backfilled og:image for article ${current.id}: ${ogImage}`);
          } else {
            markImageChecked(current.id);
          }
        }
      }

      if (newCount > 0) {
        log("info", `Feed ${feed.url}: ${newCount} new articles`);
        totalNewArticles += newCount;
      }
    } catch (err: any) {
      log("error", `Error processing feed ${feed.url}: ${err.message}`);
    }
  }

  log("info", `Poll complete: ${totalNewArticles} new articles fetched across ${feeds.length} feeds`);

  await backfillMissingImages();
}
