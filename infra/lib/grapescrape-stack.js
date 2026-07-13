import { Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GrapeScrapeFutureStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        Tags.of(this).add('Application', 'grapescrape');
        Tags.of(this).add('Project', 'grapescrape');

        const alertsTopic = sns.Topic.fromTopicArn(this, 'AlertsTopic', 'arn:aws:sns:eu-west-2:668528910170:grapescrape-alerts');
        const openAiApiKeySecretName = process.env.GRAPESCRAPE_OPENAI_API_KEY_SECRET_NAME ?? 'grapescrape/openai-api-key';
        const openAiApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
            this,
            'OpenAiApiKeySecret',
            openAiApiKeySecretName,
        );

        const userPool = new cognito.UserPool(this, 'GrapeScrapeUserPool', {
            userPoolName: 'grapescrape-user-pool',
            signInAliases: {
                email: true,
            },
            selfSignUpEnabled: false,
            mfa: cognito.Mfa.OFF,
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        const userPoolClient = new cognito.UserPoolClient(this, 'GrapeScrapeUserPoolClient', {
            userPool,
            userPoolClientName: 'grapescrape-user-pool-client',
            generateSecret: false,
            authFlows: {
                userSrp: true,
            },
            disableOAuth: true,
            preventUserExistenceErrors: true,
        });

        const userDataTable = new dynamodb.Table(this, 'UserDataTable', {
            tableName: 'grapescrape-user-data',
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        const assessmentsTable = new dynamodb.Table(this, 'AssessmentsTable', {
            tableName: 'grapescrape-assessments',
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        assessmentsTable.addGlobalSecondaryIndex({
            indexName: 'GSI1',
            partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        });

        assessmentsTable.addGlobalSecondaryIndex({
            indexName: 'GSI2',
            partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
        });

        const wineStockTable = new dynamodb.Table(this, 'WineStockTable', {
            tableName: 'grapescrape-wine-stock',
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        wineStockTable.addGlobalSecondaryIndex({
            indexName: 'GSI1',
            partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        });

        const assessmentDeadLetterQueue = new sqs.Queue(this, 'AssessmentDeadLetterQueue', {
            queueName: 'grapescrape-assessment-dlq',
            retentionPeriod: Duration.days(14),
        });

        const assessmentQueue = new sqs.Queue(this, 'AssessmentQueue', {
            queueName: 'grapescrape-assessment-queue',
            visibilityTimeout: Duration.minutes(12),
            retentionPeriod: Duration.days(4),
            deadLetterQueue: {
                queue: assessmentDeadLetterQueue,
                maxReceiveCount: 5,
            },
        });

        const retailerScraperFunction = new NodejsFunction(this, 'RetailerScraperFunction', {
            functionName: 'grapescrape-retailer-scraper',
            runtime: lambda.Runtime.NODEJS_24_X,
            architecture: lambda.Architecture.ARM_64,
            entry: path.join(__dirname, '../../src/workers/retailer-scraper/index.js'),
            handler: 'handler',
            memorySize: 256,
            timeout: Duration.minutes(10),
            environment: {
                WINE_STOCK_TABLE_NAME: wineStockTable.tableName,
                ASSESSMENT_QUEUE_URL: assessmentQueue.queueUrl,
                SNS_TOPIC_ARN: alertsTopic.topicArn,
            },
        });

        wineStockTable.grantReadWriteData(retailerScraperFunction);
        assessmentQueue.grantSendMessages(retailerScraperFunction);
        alertsTopic.grantPublish(retailerScraperFunction);

        const wineAssessorFunction = new NodejsFunction(this, 'WineAssessorFunction', {
            functionName: 'grapescrape-wine-assessor',
            runtime: lambda.Runtime.NODEJS_24_X,
            architecture: lambda.Architecture.ARM_64,
            entry: path.join(__dirname, '../../src/workers/wine-assessor/index.js'),
            handler: 'handler',
            memorySize: 256,
            reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(10),
            environment: {
                ASSESSMENTS_TABLE_NAME: assessmentsTable.tableName,
                USER_DATA_TABLE_NAME: userDataTable.tableName,
                DEFAULT_USER_ID: '5682e224-80d1-7027-767b-0617ac74683f',
                OPENAI_API_KEY_NAME: openAiApiKeySecretName,
                OPENAI_MODEL: 'gpt-5.6-terra',
                OPENAI_REASONING_EFFORT: 'medium',
                OPENAI_TEXT_VERBOSITY: 'medium',
            },
        });

        wineAssessorFunction.addEventSource(new lambdaEventSources.SqsEventSource(assessmentQueue, {
            batchSize: 10,
            reportBatchItemFailures: true,
        }));

        assessmentQueue.grantConsumeMessages(wineAssessorFunction);
        assessmentsTable.grantReadWriteData(wineAssessorFunction);
        userDataTable.grantReadData(wineAssessorFunction);
        openAiApiKeySecret.grantRead(wineAssessorFunction);

        const retailerScraperScheduleRole = new iam.Role(this, 'RetailerScraperScheduleRole', {
            assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
        });

        retailerScraperFunction.grantInvoke(retailerScraperScheduleRole);

        new scheduler.CfnSchedule(this, 'RetailerScraperSchedule', {
            name: 'grapescrape-retailer-scraper-every-2-hours',
            scheduleExpression: 'rate(2 hours)',
            flexibleTimeWindow: { mode: 'OFF' },
            state: 'ENABLED',
            target: {
                arn: retailerScraperFunction.functionArn,
                roleArn: retailerScraperScheduleRole.roleArn,
                input: JSON.stringify({ retailerId: 'tws' }),
                retryPolicy: {
                    maximumRetryAttempts: 1,
                    maximumEventAgeInSeconds: 3600,
                },
            },
        });
    }
}
