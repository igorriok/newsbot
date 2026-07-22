import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OPENCODE_SERVER_URL: z.string().url().default("http://localhost:4096"),
  OPENCODE_PROVIDER_ID: z.string().default("opencode-go"),
  OPENCODE_MODEL_ID: z.string().default("deepseek-v4-flash"),
  DATABASE_PATH: z.string().default("./data/newsbot.db"),
  POLL_CRON_SCHEDULE: z.string().default("*/10 * * * *"),
  MIN_RELEVANCE_SCORE: z.coerce.number().min(0).max(1).default(0.5),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const n = Number(part);
          if (!Number.isInteger(n)) throw new Error(`Invalid ADMIN_TELEGRAM_IDS entry: "${part}"`);
          return n;
        }),
    ),
});

export const config = configSchema.parse(process.env);
