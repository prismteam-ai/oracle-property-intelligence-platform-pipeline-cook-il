// AWS Lambda entry for infra/cdk (same Hono app as main.ts). Bootstrap runs once per cold start.
import { handle } from "hono/aws-lambda";
import { bootstrap } from "./bootstrap.js";

const ready = bootstrap().then(({ app }) => handle(app));

export const handler: ReturnType<typeof handle> = async (event, context) =>
  (await ready)(event, context);
