import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8080),
  DATA_DIR: z.string().default("data"),
  DATASET_DB: z.string().optional(),
  DATASET_DIR: z.string().optional(),
  REQUIRE_PUBLISHED_SNAPSHOT: z.enum(["true", "false"]).optional(),
  PUBLICATIONS_DIR: z.string().optional(),
  GIT_COMMIT: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MCP_HTTP_AUTH_TOKEN: z.string().optional(),
  NOMINATIM_URL: z.string().default("https://nominatim.openstreetmap.org/search"),
  LOG_LEVEL: z.string().default("info"),
});
export type Env = z.infer<typeof EnvSchema> & {
  DATASET_DB: string;
  DATASET_DIR: string;
  PUBLICATIONS_DIR: string;
};

/** Paths default to DATA_DIR (shared with the pipeline): <DATA_DIR>/cook_il.duckdb, /dataset, /publications. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const e = EnvSchema.parse(source);
  return {
    ...e,
    DATASET_DB: e.DATASET_DB ?? `${e.DATA_DIR}/cook_il.duckdb`,
    DATASET_DIR: e.DATASET_DIR ?? `${e.DATA_DIR}/dataset`,
    PUBLICATIONS_DIR: e.PUBLICATIONS_DIR ?? `${e.DATA_DIR}/publications`,
  };
}
