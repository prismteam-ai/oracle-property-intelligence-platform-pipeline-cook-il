#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Duck } from "@cook/duck";
import { loadEnv } from "./env.js";
import { fetchSources, type FetchResult } from "./fetch.js";
import { log, newRunId } from "./log.js";
import { fetchStep, finishRun, readBuildInfo, runAll, startRun, type RunContext } from "./run.js";
import { countUrl, fetchJson, whereClause } from "./socrata.js";
import { SOURCES, findSource, sourceUrl } from "./sources.js";
import { stageAll } from "./stage.js";
import { transform } from "./transform.js";
import { serve } from "./serve.js";
import { latestPublishedRun, publish, verifyPublished } from "./publish.js";
import { harvestBbb } from "./enrich/bbb.js";

const USAGE = `pipeline <discover|fetch|stage|transform|run|serve|publish|verify|bbb> [options]
  --incremental       use per-source watermarks (fetch/run)
  --sample <n>        fetch only the first n rows per source into batch 'sample' (fetch/run)
  --source <system>   restrict to one source (repeatable)
  --data <dir>        data directory (default $DATA_DIR or ./data)
  --as-of <date>      roof-age / open-days as-of date (transform; default today)
  --run <run_id>      run to publish / verify (verify: default latest under publications/)
  --previous <run_id> previous run for the CID chain (publish; default: the run's previous_run_id)
  --car-url <url>     where the CAR is downloadable, e.g. a GitHub Release asset (publish; manifest car.release_url)
  --gateways <a,b,c>  gateway prefixes to verify from (publish/verify; default: the six built-in ones)
  --verifier <name>   who verifies, e.g. pipeline-host or github-actions (default pipeline-host)
  --publications <d>  committed manifest dir (default ./publications)
  --limit <n>         bbb: contractors to look up, most permit links first (default 150)
  --min-permits <m>   bbb: minimum permit links per contractor (default 1)`;

const summary = (x: FetchResult) => ({
  source: x.source_system,
  batch: x.batch_id,
  rows: x.done?.rows_fetched ?? null,
  seconds: x.done?.seconds ?? null,
  failed_pages: x.dead_letters.length,
});

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
      run: { type: "string" },
      previous: { type: "string" },
      "car-url": { type: "string" },
      gateways: { type: "string" },
      verifier: { type: "string", default: "pipeline-host" },
      publications: { type: "string", default: "publications" },
      limit: { type: "string", default: "150" },
      "min-permits": { type: "string", default: "1" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const cmd = positionals[0];
  if (!cmd || values.help) {
    console.log(USAGE);
    return;
  }
  if (cmd === "publish" || cmd === "verify") {
    // no Socrata credentials needed; pin credentials are optional (see publish.ts)
    const publicationsDir = values.publications;
    const gateways = values.gateways
      ? {
          gateways: values.gateways
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean),
        }
      : {};
    if (cmd === "publish") {
      if (!values.run) throw new Error("publish needs --run <run_id>");
      const r = await publish({
        runId: values.run,
        previous: values.previous,
        carUrl: values["car-url"],
        dataDir: values.data ?? process.env["DATA_DIR"] ?? "data",
        publicationsDir,
        verifier: values.verifier,
        ...gateways,
      });
      console.log(
        JSON.stringify({
          run_id: values.run,
          root_cid: r.manifest.root_cid,
          manifest_cid: r.manifestCid,
          car: r.carPath,
          pins: r.manifest.pins,
          summary: r.verification.summary,
        }),
      );
    } else {
      const runId = values.run || latestPublishedRun(publicationsDir);
      if (!runId) throw new Error("verify: no --run given and nothing under publications/");
      const r = await verifyPublished({
        runId,
        publicationsDir,
        verifier: values.verifier,
        ...gateways,
      });
      console.log(JSON.stringify({ run_id: runId, file: r.file, summary: r.verification.summary }));
    }
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

  const sampleRows = values.sample ? Number(values.sample) : undefined;
  if (cmd === "fetch" && !values.incremental) {
    // plain fetch needs no database (and must not hold its lock while stage/transform run)
    const batchId = sampleRows ? "sample" : "full";
    const r = await fetchSources({ dataDir, auth, log: runLog, batchId, sampleRows, sources });
    console.log(JSON.stringify(r.map(summary)));
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
      sampleRows,
    };
    if (cmd === "fetch") {
      const r = await fetchStep(ctx);
      console.log(JSON.stringify(r.map(summary)));
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
    } else if (cmd === "bbb") {
      const r = await harvestBbb(db, {
        limit: Number(values.limit),
        minPermits: Number(values["min-permits"]),
        log: runLog,
      });
      console.log(JSON.stringify(r));
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
