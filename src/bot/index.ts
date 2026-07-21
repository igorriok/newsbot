import { Bot, Context, Keyboard } from "grammy";
import { config } from "../config";
import { upsertChat } from "../db/chats";
import { getFeedByUrl, insertFeed, deleteFeed, getAllFeeds } from "../db/feeds";
import { insertTopic, deleteTopic, getTopicsForChat, getTopicByChatAndPhrase } from "../db/topics";
import { pollCycle, isCycleRunning, classifyBacklogForNewTopic } from "../jobs/cycle";
import { log } from "../utils/log";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

export async function registerCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Show welcome message" },
    { command: "help", description: "Show available commands" },
    { command: "addfeed", description: "Add an RSS feed (global)" },
    { command: "removefeed", description: "Remove a feed by id (global)" },
    { command: "listfeeds", description: "List all feeds" },
    { command: "addtopic", description: "Add a topic to track (this chat)" },
    { command: "removetopic", description: "Remove a topic by id (this chat)" },
    { command: "listtopics", description: "List topics for this chat" },
    { command: "checkfeeds", description: "Manually trigger a feed check now" },
  ]);
}

const adminIds = new Set(config.ADMIN_TELEGRAM_IDS);

bot.use(async (ctx, next) => {
  const text = ctx.message?.text ?? ctx.channelPost?.text ?? "<non-text update>";
  log("info", `Message from telegram_id=${ctx.from?.id} chat_id=${ctx.chat?.id} (${ctx.chat?.type}): ${text}`);
  await next();
});

bot.use(async (ctx, next) => {
  if (!ctx.from || !ctx.chat || !adminIds.has(ctx.from.id)) {
    await ctx.reply("You are not authorized to use this bot.");
    return;
  }
  upsertChat(ctx.chat.id);
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to NewsBot! I monitor RSS feeds (global, shared by everyone) and notify each chat about articles matching that chat's own topics.\n\n"
    + "Commands:\n"
    + "/addfeed <url> - Add an RSS feed (global, affects everyone)\n"
    + "/removefeed <id> - Remove a feed (global, affects everyone)\n"
    + "/listfeeds - List all feeds\n"
    + "/addtopic <phrase> - Add a topic to track (this chat only)\n"
    + "/removetopic <id> - Remove a topic (this chat only)\n"
    + "/listtopics - List topics for this chat\n"
    + "/checkfeeds - Manually trigger a feed check now\n"
    + "/help - Show this message"
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Commands:\n"
    + "/addfeed <url> - Add an RSS feed (global, affects everyone)\n"
    + "/removefeed <id> - Remove a feed (global, affects everyone)\n"
    + "/listfeeds - List all feeds\n"
    + "/addtopic <phrase> - Add a topic to track (this chat only)\n"
    + "/removetopic <id> - Remove a topic (this chat only)\n"
    + "/listtopics - List topics for this chat\n"
    + "/checkfeeds - Manually trigger a feed check now"
  );
});

bot.command("addfeed", async (ctx) => {
  let url = ctx.match.trim();
  if (!url) {
    await ctx.reply("Usage: /addfeed <url>");
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  const existing = getFeedByUrl(url);
  if (existing) {
    await ctx.reply(`Feed already exists: ${existing.url}`);
    return;
  }

  const feed = insertFeed(url);
  await ctx.reply(`Feed added globally: ${feed.url}`);
});

bot.command("removefeed", async (ctx) => {
  const idStr = ctx.match.trim();
  const id = parseInt(idStr, 10);
  if (!idStr || isNaN(id)) {
    await ctx.reply("Usage: /removefeed <id> (use /listfeeds to see IDs)");
    return;
  }

  const ok = deleteFeed(id);
  await ctx.reply(ok ? "Feed removed globally." : "Feed not found.");
});

bot.command("listfeeds", async (ctx) => {
  const feeds = getAllFeeds();
  if (feeds.length === 0) {
    await ctx.reply("No feeds yet. Use /addfeed <url> to add one.");
    return;
  }
  const lines = feeds.map((f) => `[${f.id}] ${f.title ?? f.url}${f.healthy ? "" : " ⚠️ failing"}`);
  await ctx.reply("All feeds:\n" + lines.join("\n"));
});

bot.command("addtopic", async (ctx) => {
  const phrase = ctx.match.trim();
  if (!phrase) {
    await ctx.reply("Usage: /addtopic <phrase>");
    return;
  }

  const chat = upsertChat(ctx.chat.id);

  const existing = getTopicByChatAndPhrase(chat.id, phrase);
  if (existing) {
    await ctx.reply(`Already tracking topic: "${existing.phrase}"`);
    return;
  }

  const topic = insertTopic(chat.id, phrase);
  await ctx.reply(`Added topic: "${topic.phrase}". Checking existing articles for matches in the background...`);

  classifyBacklogForNewTopic(topic).catch((err: any) => {
    log("error", `Backfill classification failed for topic ${topic.id}: ${err.message}`);
  });
});

bot.command("removetopic", async (ctx) => {
  const idStr = ctx.match.trim();
  const id = parseInt(idStr, 10);
  if (!idStr || isNaN(id)) {
    await ctx.reply("Usage: /removetopic <id> (use /listtopics to see IDs)");
    return;
  }

  const chat = upsertChat(ctx.chat.id);
  const ok = deleteTopic(id, chat.id);
  await ctx.reply(ok ? "Topic removed." : "Topic not found.");
});

bot.command("listtopics", async (ctx) => {
  const chat = upsertChat(ctx.chat.id);
  const topics = getTopicsForChat(chat.id);
  if (topics.length === 0) {
    await ctx.reply("No topics. Use /addtopic <phrase> to add one.");
    return;
  }
  const lines = topics.map((t) => `[${t.id}] ${t.phrase}`);
  await ctx.reply("Topics for this chat:\n" + lines.join("\n"));
});

bot.command("checkfeeds", async (ctx) => {
  if (isCycleRunning()) {
    await ctx.reply("A feed check is already in progress.");
    return;
  }
  await ctx.reply("Checking feeds now...");
  try {
    await pollCycle();
    await ctx.reply("Feed check complete.");
  } catch (err: any) {
    log("error", `Manual feed check failed: ${err.message}`);
    await ctx.reply("Feed check failed, see logs.");
  }
});
