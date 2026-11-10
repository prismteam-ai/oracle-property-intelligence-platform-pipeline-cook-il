import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8080),
  DATASET_DB: z.string().default('data/cook_il.duckdb'),
  DATASET_DIR: z.string().default('data/dataset'),
  PUBLICATIONS_DIR: z.string().default('publications'),
  OPENAI_API_KEY: z.string().optional(),
  MCP_HTTP_AUTH_TOKEN: z.string().optional(),
  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org/search'),
  LOG_LEVEL: z.string().default('info'),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
