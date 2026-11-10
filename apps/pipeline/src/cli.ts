#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Duck } from "@cook/duck";
import { loadEnv } from "./env.js";
import { log, newRunId } from "./log.js";
import { fetchStep, finishRun, readBuildInfo, runAll, startRun, type RunContext } from "./run.js";
import { countUrl, fetchJson, whereClause } from "./socrata.js";
import { SOURCES, findSource, sourceUrl } from "./sources.js";
import { stageAll } from "./stage.js";
import { transform } from "./transform.js";
import { serve } from "./serve.js";

const USAGE = `pipeline <discover|fetch|stage|transform|run|serve> [options]
  --incremental       use per-source watermarks (fetch/run)
  --sample <n>        fetch only the first n rows per source into batch 'sample' (fetch/run)
  --source <system>   restrict to one source (repeatable)
  --data <dir>        data directory (default $DATA_DIR or ./data)
  --as-of <date>      roof-age / open-days as-of date (transform; default today)`;

async function main(): Promise<void> {
  loadDotenv({ quiet: true });
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      incremental: { type: "boolean", default: false },
      sample: { type: "string" },
      source: { type: "string", multiple: true },
      data: { type: "string" },
      "as-of": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const cmd = positionals[0];
  if (!cmd || values.help) {
    console.log(USAGE);
    return;
  }
  const env = loadEnv();
  const dataDir = values.data ?? env.DATA_DIR;
  mkdirSync(join(dataDir, "logs"), { recursive: true });
  const auth = { keyId: env.SOCRATA_KEY_ID, keySecret: env.SOCRATA_KEY_SECRET };
  const sources = values.source?.length ? values.source.map(findSource) : undefined;
  const runId = newRunId();
  const runLog = log.child({ run_id: runId, cmd });

  if (cmd === "discover") {
    const rows = [];
    for (const s of SOURCES) {
      const t0 = Date.now();
      const r = (await fetchJson(countUrl(s, whereClause(s)), { auth })) as {
        n: string;
        max_updated_at?: string;
      }[];
      rows.push({
        source_system: s.system,
        dataset_id: s.datasetId,
        url: sourceUrl(s),
        where: s.where ?? null,
        total_rows: Number(r[0]?.n ?? 0),
        max_updated_at: r[0]?.max_updated_at ?? null,
        count_ms: Date.now() - t0,
      });
    }
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const db = await Duck.open(join(dataDir, "cook_il.duckdb"));
  try {
    const ctx: RunContext = {
      db,
      dataDir,
      auth,
      log: runLog,
      runId,
      incremental: values.incremental,
      sources,
      sampleRows: values.sample ? Number(values.sample) : undefined,
    };
    if (cmd === "fetch") {
      const r = await fetchStep(ctx);
      console.log(
        JSON.stringify(
          r.map((x) => ({
            source: x.source_system,
            batch: x.batch_id,
            rows: x.done?.rows_fetched ?? null,
            seconds: x.done?.seconds ?? null,
            failed_pages: x.dead_letters.length,
          })),
        ),
      );
    } else if (cmd === "stage") {
      const r = await stageAll(db, dataDir, runId, runLog, sources);
      console.log(JSON.stringify(r));
    } else if (cmd === "transform") {
      await startRun(ctx);
      try {
        const t = await transform(db, {
          dataDir,
          runId,
          log: runLog,
          ...(values["as-of"] ? { asOf: values["as-of"] } : {}),
        });
        const run = await finishRun(ctx, "ok", { transform: t });
        console.log(
          JSON.stringify({
            run_id: run.run_id,
            counts: run.counts,
            deltas: run.deltas,
            parquet_dir: t.parquet_dir,
          }),
        );
      } catch (e) {
        await finishRun(ctx, "failed", { error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    } else if (cmd === "run") {
      const run = await runAll(ctx);
      console.log(
        JSON.stringify({
          run_id: run.run_id,
          status: run.status,
          counts: run.counts,
          deltas: run.deltas,
          dead_letters: run.dead_letters.length,
        }),
      );
    } else if (cmd === "serve") {
      serve(db, env.PORT, readBuildInfo(process.cwd()));
      await new Promise(() => undefined);
    } else {
      console.log(USAGE);
      process.exitCode = 2;
    }
  } finally {
    if (cmd !== "serve") db.close();
  }
}

main().catch((e: unknown) => {
  log.error({ error: e instanceof Error ? e.message : String(e) }, "fatal");
  process.exit(1);
});
