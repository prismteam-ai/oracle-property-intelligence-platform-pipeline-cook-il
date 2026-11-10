#!/usr/bin/env node
// CDK app for the Cook County pipeline web/API. Synthesized in CI (`cdk synth`), NOT deployed for this
// assessment: the live runtime is hosted in Docker on a VM at zero cost. See docs/kit-usage.md.
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack.js";

const app = new App();
new ApiStack(app, "CookIlApiStack", {
  env: { region: "us-east-2" },
  appName: "cook-il",
  githubRepo: "vsterian/oracle-property-intelligence-platform-pipeline-cook-il",
});
