import { CfnOutput, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
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

        const userPool = new cognito.UserPool(this, 'AppIdentityUserPool', {
            userPoolName: 'grapescrape-user-pool',
            signInAliases: {
                email: true,
            },
            selfSignUpEnabled: false,
            mfa: cognito.Mfa.OFF,
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        const userPoolClient = new cognito.UserPoolClient(this, 'AppIdentityUserPoolClient', {
            userPool,
            userPoolClientName: 'grapescrape-user-pool-client',
            generateSecret: false,
            authFlows: {
                userSrp: true,
            },
            disableOAuth: true,
            preventUserExistenceErrors: true,
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

        new CfnOutput(this, 'AppIdentityUserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito user pool ID for GrapeScrape app identity.',
        });

        new CfnOutput(this, 'AppIdentityUserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito user pool client ID for future GrapeScrape app/API integrations.',
        });

        new CfnOutput(this, 'AppIdentityUserSubLookup', {
            value: `After manually creating a user, retrieve their Cognito sub with: aws cognito-idp admin-get-user --user-pool-id ${userPool.userPoolId} --username <email> --query 'UserAttributes[?Name==\`sub\`].Value | [0]' --output text`,
            description: 'Manual command for retrieving a Cognito user sub from an email username.',
        });
    }
}
