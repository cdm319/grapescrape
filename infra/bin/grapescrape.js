#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { GrapeScrapeStack } from '../lib/grapescrape-stack.js';

const app = new cdk.App();

new GrapeScrapeStack(app, 'GrapeScrapeStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: 'eu-west-2'
    }
});