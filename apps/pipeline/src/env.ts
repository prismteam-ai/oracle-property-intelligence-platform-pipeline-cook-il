import { z } from "zod";

const Env = z.object({
  SOCRATA_KEY_ID: z.string().min(1),
  SOCRATA_KEY_SECRET: z.string().min(1),
  DATA_DIR: z.string().default("data"),
  PORT: z.coerce.number().int().default(8080),
  GIT_COMMIT: z.string().default("unknown"),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = Env.safeParse(source);
  if (!r.success) {
    const missing = r.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid environment: ${missing}`);
  }
  return r.data;
}
