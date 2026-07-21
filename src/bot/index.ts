import { Bot, Context, Keyboard } from "grammy";
import { config } from "../config";
import { upsertUser } from "../db/users";
import { getFeedByUrl, insertFeed, getFeedById, getAllFeeds, updateFeedMeta } from "../db/feeds";
import { subscribe, unsubscribe, getSubscriptionsForUser } from "../db/subscriptions";
import { insertTopic, deleteTopic, getTopicsForUser } from "../db/topics";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (ctx.from) {
    upsertUser(ctx.from.id);
  }
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to NewsBot! I monitor RSS feeds and notify you about articles matching your topics.\n\n"
    + "Commands:\n"
    + "/addfeed <url> - Subscribe to an RSS feed\n"
    + "/removefeed <id> - Unsubscribe from a feed\n"
    + "/listfeeds - List your feeds\n"
    + "/addtopic <phrase> - Add a topic to track\n"
    + "/removetopic <id> - Remove a topic\n"
    + "/listtopics - List your topics\n"
    + "/help - Show this message"
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Commands:\n"
    + "/addfeed <url> - Subscribe to an RSS feed\n"
    + "/removefeed <id> - Unsubscribe from a feed\n"
    + "/listfeeds - List your feeds\n"
    + "/addtopic <phrase> - Add a topic to track\n"
    + "/removetopic <id> - Remove a topic\n"
    + "/listtopics - List your topics"
  );
});

bot.command("addfeed", async (ctx) => {
  const url = ctx.match.trim();
  if (!url) {
    await ctx.reply("Usage: /addfeed <url>");
    return;
  }

  let feed = getFeedByUrl(url);
  if (!feed) {
    feed = insertFeed(url);
  }

  if (!ctx.from) return;
  const user = upsertUser(ctx.from.id);
  subscribe(user.id, feed.id);
  await ctx.reply(`Subscribed to feed: ${feed.url}`);
});

bot.command("removefeed", async (ctx) => {
  const idStr = ctx.match.trim();
  const id = parseInt(idStr, 10);
  if (!idStr || isNaN(id)) {
    await ctx.reply("Usage: /removefeed <id> (use /listfeeds to see IDs)");
    return;
  }

  if (!ctx.from) return;
  const user = upsertUser(ctx.from.id);
  unsubscribe(user.id, id);
  await ctx.reply("Unsubscribed from feed.");
});

bot.command("listfeeds", async (ctx) => {
  if (!ctx.from) return;
  const user = upsertUser(ctx.from.id);
  const subs = getSubscriptionsForUser(user.id);
  if (subs.length === 0) {
    await ctx.reply("No subscriptions. Use /addfeed <url> to add one.");
    return;
  }
  const lines = subs.map((s, i) => `${i + 1}. [${s.feed_id}] ${s.title ?? s.url}`);
  await ctx.reply("Your feeds:\n" + lines.join("\n"));
});

bot.command("addtopic", async (ctx) => {
  const phrase = ctx.match.trim();
  if (!phrase) {
    await ctx.reply("Usage: /addtopic <phrase>");
    return;
  }

  if (!ctx.from) return;
  const user = upsertUser(ctx.from.id);
  const topic = insertTopic(user.id, phrase);
  await ctx.reply(`Added topic: "${topic.phrase}" (id: ${topic.id})`);
});

bot.command("removetopic", async (ctx) => {
  const idStr = ctx.match.trim();
  const id = parseInt(idStr, 10);
  if (!idStr || isNaN(id)) {
    await ctx.reply("Usage: /removetopic <id> (use /listtopics to see IDs)");
    return;
  }

  if (!ctx.from) return;
  const user = upsertUser(ctx.from.id);
  const ok = deleteTopic(id, user.id);
  await ctx.reply(ok ? "Topic removed." : "Topic not found.");
});

bot.command("listtopics", async (ctx) => {
  if (!ctx.from) return;
  const user = upsertUser(ctx.from.id);
  const topics = getTopicsForUser(user.id);
  if (topics.length === 0) {
    await ctx.reply("No topics. Use /addtopic <phrase> to add one.");
    return;
  }
  const lines = topics.map((t) => `[${t.id}] ${t.phrase}`);
  await ctx.reply("Your topics:\n" + lines.join("\n"));
});
