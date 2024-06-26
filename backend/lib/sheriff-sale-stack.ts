import { config } from 'dotenv';
config({ path: __dirname + '/../../.env' });

import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';

import { SheriffSaleHandler } from './constructs';

export class SheriffSaleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const { ENV } = process.env;
    if (!ENV) throw new Error('ENV not set');

    const newJerseySheriffSaleBucket = new s3.Bucket(this, 'NewJerseySheriffSaleBucket', {
      bucketName: `nj-sheriff-sale-${ENV}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: ENV === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const newJerseySheriffSaleScraper = new SheriffSaleHandler(this, 'NewJerseySheriffSaleScraper', {
      deadLetterQueue: new sqs.Queue(this, 'NewJerseySheriffSaleScraperDLQ', {
        queueName: `new-jersey-sheriff-sale-scraper-dlq-${ENV}`,
        retentionPeriod: Duration.days(14),
      }),
      entry: 'src/handlers/newJerseySheriffSaleScraperHandler.ts',
      functionName: `new-jersey-sheriff-sale-scraper-${ENV}`,
      handler: 'handler',
      memorySize: 512,
      role: new iam.Role(this, 'NewJerseySheriffSaleScraperRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        inlinePolicies: {
          NewJerseySheriffSaleScraperPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectAcl'],
                effect: iam.Effect.ALLOW,
                resources: [newJerseySheriffSaleBucket.arnForObjects('*')],
              }),
            ],
          }),
        },
        managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
        roleName: `new-jersey-sheriff-sale-scraper-role-${ENV}`,
      }),
      timeout: Duration.minutes(15),
    });

    new events.Rule(this, 'NewJerseySheriffSaleScraperRule', {
      description: 'New Jersey Sheriff Sale Scraper cron rule to run at 12:00AM UTC every day',
      ruleName: `new-jersey-sheriff-sale-scraper-rule-${ENV}`,
      schedule: events.Schedule.cron({
        year: '*',
        month: '*',
        day: '*',
        hour: '0',
        minute: '0',
      }),
      targets: [new eventTargets.LambdaFunction(newJerseySheriffSaleScraper)],
    });
  }
}
