import { Duration, Stack, Tags } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';

export class GrapeScrapeStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        Tags.of(this).add('Application', 'grapescrape');
        Tags.of(this).add('Project', 'grapescrape');

        const stateBucket = s3.Bucket.fromBucketArn(this, 'StateBucket', 'arn:aws:s3:::grapescrape-668528910170-eu-west-2-an');
        const alertsTopic = sns.Topic.fromTopicArn(this, 'AlertsTopic', 'arn:aws:sns:eu-west-2:668528910170:grapescrape-alerts')

        const grapescrapeFunction = new lambda.Function(this, 'GrapeScrapeFunction', {
            functionName: 'grapescrape-cdk',
            runtime: lambda.Runtime.NODEJS_24_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'src/app/lambda.handler',
            code: lambda.Code.fromAsset('.', {
                bundling: {
                    image: lambda.Runtime.NODEJS_24_X.bundlingImage,
                    command: [
                        'bash',
                        '-c',
                        [
                            'cp -R src package.json package-lock.json /asset-output/',
                            'cd /asset-output',
                            'npm ci --omit=dev --cache /tmp/.npm'
                        ].join(' && ')
                    ]
                },
                exclude: [
                    'infra',
                    '.git',
                    'node_modules',
                    'localStore.json',
                    'testStore.json'
                ]
            }),
            memorySize: 256,
            timeout: Duration.seconds(120),
            environment: {
                STORE_BUCKET: "grapescrape-668528910170-eu-west-2-an",
                STORE_KEY: "wineStore.json",
                SNS_TOPIC_ARN: "arn:aws:sns:eu-west-2:668528910170:grapescrape-alerts"
            }
        });

        stateBucket.grantReadWrite(grapescrapeFunction);
        alertsTopic.grantPublish(grapescrapeFunction);

        const schedulerRole = new iam.Role(this, 'GrapeScrapeSchedulerRole', {
            assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com')
        });

        grapescrapeFunction.grantInvoke(schedulerRole);

        new scheduler.CfnSchedule(this, 'GrapeScrapeSchedule', {
            name: 'grapescrape-cdk-every-3-hours',
            flexibleTimeWindow: { mode: 'OFF' },
            scheduleExpression: 'rate(3 hours)',
            target: {
                arn: grapescrapeFunction.functionArn,
                roleArn: schedulerRole.roleArn,
                input: JSON.stringify({}),
                retryPolicy: {
                    maximumRetryAttempts: 2,
                    maximumEventAgeInSeconds: 3600
                }
            }
        });
    }
}