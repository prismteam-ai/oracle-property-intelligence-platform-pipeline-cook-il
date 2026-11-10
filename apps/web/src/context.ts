import type { LanguageModel } from "ai";
import type { Dataset } from "./db/duck.js";
import type { Env } from "./env.js";
import { datasetInfo, type DatasetInfo } from "./runs.js";

export interface AppContext {
  ds: Dataset;
  env: Env;
  /** publications/<run_id> lookup dirs, first hit wins */
  pubDirs: string[];
  model: LanguageModel | null;
  info: () => Promise<DatasetInfo>;
}

export function createContext(base: Omit<AppContext, "info">): AppContext {
  let cached: Promise<DatasetInfo> | null = null;
  return {
    ...base,
    info: () =>
      (cached ??= datasetInfo(base.ds, base.pubDirs).catch((e) => {
        cached = null;
        throw e;
      })),
  };
}
