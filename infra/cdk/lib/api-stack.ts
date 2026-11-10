import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Runtime, Architecture, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Alarm, ComparisonOperator } from "aws-cdk-lib/aws-cloudwatch";
import { App as AmplifyApp, GitHubSourceCodeProvider, Platform } from "@aws-cdk/aws-amplify-alpha";
import { SecretValue } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export interface ApiStackProps extends StackProps {
  appName: string;
  githubRepo: string; // owner/repo
  /** Lambda entry (Hono app wrapped with hono/aws-lambda). Defaults to apps/web/src/lambda.ts. */
  entry?: string;
}

/**
 * Kit-shaped deployment (metagross / build-frontend-backends): tRPC router on Lambda behind an
 * API Gateway HTTP API, static web on Amplify, artifacts on S3, a dead-letter queue with an alarm.
 * The handler path points at the same Hono/tRPC app the Docker runtime serves.
 */
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const [owner, repository] = props.githubRepo.split("/") as [string, string];

    const artifacts = new Bucket(this, "Artifacts", {
      bucketName: undefined,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    const dlq = new Queue(this, "IngestDeadLetters", { retentionPeriod: Duration.days(14) });
    new Alarm(this, "DeadLetterAlarm", {
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "Ingest records that failed after retries",
    });

    const api = new NodejsFunction(this, "ApiHandler", {
      entry: props.entry ?? resolve(here, "../../../apps/web/src/lambda.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(29),
      tracing: Tracing.ACTIVE,
      environment: {
        ARTIFACTS_BUCKET: artifacts.bucketName,
        DEAD_LETTER_QUEUE_URL: dlq.queueUrl,
        POWERTOOLS_SERVICE_NAME: `${props.appName}-api`,
        LOG_LEVEL: "INFO",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        format: OutputFormat.ESM,
        externalModules: ["@duckdb/node-api", "@duckdb/node-bindings"],
      },
    });
    artifacts.grantRead(api);
    dlq.grantSendMessages(api);

    const httpApi = new HttpApi(this, "HttpApi", { apiName: `${props.appName}-api` });
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("ApiIntegration", api),
    });

    const web = new AmplifyApp(this, "Web", {
      appName: `${props.appName}-web`,
      platform: Platform.WEB,
      sourceCodeProvider: new GitHubSourceCodeProvider({
        owner,
        repository,
        oauthToken: SecretValue.secretsManager("github-token"),
      }),
      environmentVariables: { VITE_API_URL: httpApi.apiEndpoint },
    });
    web.addBranch("main");

    new CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "ArtifactsBucket", { value: artifacts.bucketName });
  }
}
