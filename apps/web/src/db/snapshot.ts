import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { getPublication, publishedRunIds } from "../publications.js";
import type { Row } from "./duck.js";

export interface PublishedSnapshot {
  runId: string;
  dir: string;
  history: Row[];
  files: string[];
}

/** Serving gate: at least two gateways returned every manifest object intact (mirrors the publish gate). */
export const MIN_VERIFIED_GATEWAYS = 2;

/** Validate local readback against the published manifest before serving any CID claim. */
export async function publishedSnapshot(
  datasetDir: string,
  pubDirs: string[],
  historyPath: string,
): Promise<PublishedSnapshot | null> {
  for (const runId of publishedRunIds(pubDirs)) {
    const pub = getPublication(pubDirs, runId);
    const dir = resolve(datasetDir, runId);
    if (!pub.manifest || !existsSync(join(dir, "property"))) continue;
    const verified = new Set(
      pub.verifications
        .filter((v) => v.data.root_cid === pub.manifest?.root_cid)
        .flatMap((v) =>
          Object.entries(v.data.summary)
            .filter(([, s]) => s.total > 0 && s.ok === s.total)
            .map(([gateway]) => gateway),
        ),
    );
    if (verified.size < MIN_VERIFIED_GATEWAYS) continue;
    if (!existsSync(historyPath))
      throw new Error(
        "published snapshot needs run-history.json; run pipeline export-history first",
      );
    const history = JSON.parse(readFileSync(historyPath, "utf8")) as Row[];
    if (!history.some((r) => r.run_id === runId && r.status === "ok"))
      throw new Error(`published snapshot ${runId} has no completed run metadata`);
    const files = pub.manifest.objects.filter((o) => o.codec === "file");
    if (!files.length) throw new Error(`published snapshot ${runId} has no files`);
    for (const object of files) {
      const path = resolve(dir, object.name);
      if (!path.startsWith(dir + sep)) throw new Error("manifest path escapes snapshot");
      const digest = createHash("sha256");
      let size = 0;
      for await (const chunk of createReadStream(path)) {
        const bytes = chunk as Buffer;
        size += bytes.length;
        digest.update(bytes);
      }
      if (size !== object.size || digest.digest("hex") !== object.sha256)
        throw new Error(`published snapshot integrity mismatch: ${object.name}`);
    }
    return { runId, dir, history, files: files.map((o) => resolve(dir, o.name)) };
  }
  return null;
}
