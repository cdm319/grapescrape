#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import {
    GrapeScrapeAuthCertificateStack,
    GrapeScrapeFutureStack,
} from '../lib/grapescrape-stack.js';

const app = new cdk.App();
const account = process.env.GRAPESCRAPE_AWS_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT ?? '668528910170';
const region = process.env.GRAPESCRAPE_AWS_REGION ?? 'eu-west-2';

const authCertificateStack = new GrapeScrapeAuthCertificateStack(
    app,
    'GrapeScrapeAuthCertificateStack',
    {
        crossRegionReferences: true,
        env: {
            account,
            region: 'us-east-1',
        },
    },
);

new GrapeScrapeFutureStack(app, 'GrapeScrapeFutureStack', {
    authCertificate: authCertificateStack.authCertificate,
    crossRegionReferences: true,
    env: {
        account,
        region,
    },
});
