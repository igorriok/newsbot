import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// eslint-disable-next-line @typescript-eslint/typedef -- z.ZodTypeAny would erase the field types z.infer<> needs below
const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL_ID: z.string().default("gemma-4-e4b-it-qat"),
  LLM_BASE_URL: z.string().url().default("https://ai.solonari.com/api/v1"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  LLM_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(5_000),
  DATABASE_PATH: z.string().default("./data/newsbot.db"),
  POLL_CRON_SCHEDULE: z.string().default("0 * * * *"),
  MIN_RELEVANCE_SCORE: z.coerce.number().min(0).max(1).default(0.5),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default("")
    .transform((str) =>
      str
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const num: number = Number(part);
          if (!Number.isInteger(num)) throw new Error(`Invalid ADMIN_TELEGRAM_IDS entry: "${part}"`);
          return num;
        }),
    ),
});

export const config: z.infer<typeof configSchema> = configSchema.parse(process.env);
