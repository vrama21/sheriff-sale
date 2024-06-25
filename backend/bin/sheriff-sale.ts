#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SheriffSaleStack } from '../lib/sheriff-sale-stack';

const app = new cdk.App();

new SheriffSaleStack(app, 'SheriffSaleStack', {
  env: { account: '590184139982', region: 'us-east-2' },
});
