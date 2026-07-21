import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OPENCODE_SERVER_URL: z.string().url().default("http://localhost:4096"),
  OPENCODE_PROVIDER_ID: z.string().default("opencode-go"),
  OPENCODE_MODEL_ID: z.string().default("deepseek-v4-flash"),
  DATABASE_PATH: z.string().default("./data/newsbot.db"),
});

export const config = configSchema.parse(process.env);
