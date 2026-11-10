import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ApiStack } from "../lib/api-stack.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("ApiStack", () => {
  it("synthesizes a Lambda-backed HTTP API, Amplify app, S3 bucket and DLQ alarm in us-east-2", () => {
    const app = new App();
    mkdirSync(join(process.cwd(), "test", "fixtures"), { recursive: true });
    const entry = join(process.cwd(), "test", "fixtures", "lambda.ts");
    writeFileSync(entry, "export const handler = async () => ({ statusCode: 200, body: 'ok' });\n");
    const stack = new ApiStack(app, "Test", {
      env: { region: "us-east-2" },
      appName: "cook-il",
      githubRepo: "vsterian/x",
      entry,
    });
    const t = Template.fromStack(stack);
    t.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    t.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      TracingConfig: { Mode: "Active" },
    });
    t.resourceCountIs("AWS::Amplify::App", 1);
    t.hasResourceProperties("AWS::S3::Bucket", { VersioningConfiguration: { Status: "Enabled" } });
    t.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    expect(stack.region).toBe("us-east-2");
  });
});
