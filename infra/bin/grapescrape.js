#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { GrapeScrapeFutureStack } from '../lib/grapescrape-stack.js';

const app = new cdk.App();
const account = process.env.GRAPESCRAPE_AWS_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT ?? '668528910170';
const region = process.env.GRAPESCRAPE_AWS_REGION ?? 'eu-west-2';

new GrapeScrapeFutureStack(app, 'GrapeScrapeFutureStack', {
    env: {
        account,
        region
    }
});
