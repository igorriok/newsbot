import Parser from "rss-parser";
import { Feed, FeedUrlRef, getAllDistinctFeedUrls, getFeedById, updateFeedMeta } from "../db/feeds";
import {
  insertArticle,
  updateArticleImage,
  getArticleByGuid,
  markImageChecked,
  getArticlesMissingImage,
  Article,
} from "../db/articles";
import { log } from "../utils/log";

function formatCause<T>(cause: T): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return JSON.stringify(cause);
}

interface MediaAttributes {
  url?: string;
}

interface MediaGroupContent {
  $?: MediaAttributes;
}

interface Enclosure {
  url?: string;
  type?: string;
}

interface ParserItem {
  guid?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  pubDate?: string;
  isoDate?: string;
  mediaContent?: MediaGroupContent;
  mediaThumbnail?: MediaGroupContent;
  enclosure?: Enclosure;
  "content:encoded"?: string;
}

interface FeedMeta {
  title?: string;
  description?: string;
}

const parser: Parser<FeedMeta, ParserItem> = new Parser<FeedMeta, ParserItem>({
  headers: { "User-Agent": "NewsBot/1.0" },
  timeout: 15000,
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

interface ArticleData {
  guid: string;
  url?: string;
  title?: string;
  summary?: string;
  published_at?: string;
  image_url?: string;
}

interface FetchResult {
  articles: ArticleData[];
  etag?: string;
  lastModified?: string;
  title?: string;
}

export function sanitizeImageUrl(url: string): string {
  // Some feeds (e.g. buggy WordPress media RSS plugins) duplicate the domain in the
  // path, e.g. https://example.com/example.com/wp-content/... — collapse that back down.
  const match: RegExpMatchArray | null = url.match(/^(https?:\/\/)([^/]+)\/\2(\/.*)$/);
  return match ? `${match[1]}${match[2]}${match[3]}` : url;
}

export function extractImageUrl(item: ParserItem): string | undefined {
  const mediaContentUrl: string | undefined = item.mediaContent?.$?.url;
  if (mediaContentUrl) return sanitizeImageUrl(mediaContentUrl);

  const mediaThumbnailUrl: string | undefined = item.mediaThumbnail?.$?.url;
  if (mediaThumbnailUrl) return sanitizeImageUrl(mediaThumbnailUrl);

  if (item.enclosure?.url && item.enclosure.type?.startsWith("image/")) {
    return sanitizeImageUrl(item.enclosure.url);
  }

  const html: string | undefined = item.content ?? item["content:encoded"];
  const match: RegExpMatchArray | null | undefined = html?.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? sanitizeImageUrl(match[1]) : undefined;
}

async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const response: Response = await fetch(url, {
      headers: { "User-Agent": "NewsBot/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return undefined;

    const html: string = await response.text();

    const ogImage: RegExpMatchArray | null =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImage?.[1]) return sanitizeImageUrl(ogImage[1]);

    const twitterImage: RegExpMatchArray | null =
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (twitterImage?.[1]) return sanitizeImageUrl(twitterImage[1]);

    // Fallback for WordPress sites without an SEO plugin exposing og:image: the
    // standard featured-image markup still carries a recognizable class.
    const featuredImage: RegExpMatchArray | null =
      html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i) ??
      html.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*wp-post-image[^"']*["']/i);
    if (featuredImage?.[1]) return sanitizeImageUrl(featuredImage[1]);

    return undefined;
  } catch (err: unknown) {
    log("debug", `Failed to fetch og:image from ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

async function fetchFeed(url: string, etag?: string | null, lastModified?: string | null): Promise<FetchResult | null> {
  log("debug", `Fetching feed: ${url}`);

  try {
    const headers: Record<string, string> = { "User-Agent": "NewsBot/1.0" };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const response: Response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (response.status === 304) {
      log("info", `Feed not modified (304): ${url}`);
      return { articles: [], etag: etag ?? undefined, lastModified: lastModified ?? undefined };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml: string = await response.text();
    const feed: Awaited<ReturnType<typeof parser.parseString>> = await parser.parseString(xml);

    log("info", `Fetched feed ${url}: HTTP ${response.status}, ${feed.items.length} items in response`);

    return {
      articles: feed.items.map((item: ParserItem) => ({
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
  } catch (err: unknown) {
    const cause: string = err instanceof Error && err.cause ? ` (cause: ${formatCause(err.cause)})` : "";

    log("error", `Failed to fetch feed ${url}: ${err instanceof Error ? err.message : String(err)}${cause}`);
    return null;
  }
}

async function backfillMissingImages(): Promise<void> {
  const articles: Article[] = getArticlesMissingImage(30);
  if (articles.length === 0) return;

  log("info", `Backfilling og:image for ${articles.length} existing articles missing an image`);

  for (const article of articles) {
    const ogImage: string | undefined = article.url ? await fetchOgImage(article.url) : undefined;

    if (ogImage) {
      updateArticleImage(article.id, ogImage);
      log("debug", `Backfilled og:image for article ${article.id}: ${ogImage}`);
    } else {
      markImageChecked(article.id);
    }
  }
}

export async function pollOnce(): Promise<void> {
  const feeds: FeedUrlRef[] = getAllDistinctFeedUrls();
  if (feeds.length === 0) return;

  log("info", `Polling ${feeds.length} feeds...`);

  let totalNewArticles: number = 0;

  for (const feed of feeds) {
    try {
      const meta: Feed | undefined = getFeedById(feed.id);
      const result: FetchResult | null = await fetchFeed(feed.url, meta?.etag, meta?.last_modified);

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

      let newCount: number = 0;

      for (const item of result.articles) {
        if (!item.guid) continue;
        const inserted: Article | null = insertArticle(feed.id, item.guid, {
          url: item.url,
          title: item.title,
          summary: item.summary,
          published_at: item.published_at,
          image_url: item.image_url,
        });
        if (inserted) newCount++;

        const current: Article | undefined = inserted ?? getArticleByGuid(feed.id, item.guid);

        if (current && !current.image_url && !current.image_checked && item.url) {
          const ogImage: string | undefined = await fetchOgImage(item.url);

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
    } catch (err: unknown) {
      log("error", `Error processing feed ${feed.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("info", `Poll complete: ${totalNewArticles} new articles fetched across ${feeds.length} feeds`);

  await backfillMissingImages();
}
