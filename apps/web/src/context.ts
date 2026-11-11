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
  let cachedFor: number | undefined;
  return {
    ...base,
    info: () => {
      // The provenance block is per snapshot: recompute after the dataset activated a publication or reloaded history.
      if (cachedFor !== base.ds.version) {
        cached = null;
        cachedFor = base.ds.version;
      }
      return (cached ??= datasetInfo(base.ds, base.pubDirs).catch((e) => {
        cached = null;
        throw e;
      }));
    },
  };
}
