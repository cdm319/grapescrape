import { CfnOutput, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
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

const API_DOMAIN_NAME = 'api.grapescrape.com';
const AUTH_DOMAIN_NAME = 'auth.grapescrape.com';
const FRONTEND_ORIGIN = 'https://app.grapescrape.com';
const FRONTEND_CALLBACK_URL = `${FRONTEND_ORIGIN}/auth/callback`;

export class GrapeScrapeAuthCertificateStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        Tags.of(this).add('Application', 'grapescrape');
        Tags.of(this).add('Project', 'grapescrape');

        this.authCertificate = new certificatemanager.Certificate(this, 'AuthCertificate', {
            domainName: AUTH_DOMAIN_NAME,
            certificateName: 'grapescrape-auth-domain',
            validation: certificatemanager.CertificateValidation.fromDns(),
        });

        new CfnOutput(this, 'AuthCertificateArn', {
            description: 'ACM certificate for the Cognito custom domain in us-east-1.',
            value: this.authCertificate.certificateArn,
        });
    }
}

export class GrapeScrapeFutureStack extends Stack {
    constructor(scope, id, props) {
        const { authCertificate, ...stackProps } = props;
        super(scope, id, stackProps);

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
            featurePlan: cognito.FeaturePlan.ESSENTIALS,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        const userPoolClient = new cognito.UserPoolClient(this, 'GrapeScrapeUserPoolClient', {
            userPool,
            userPoolClientName: 'grapescrape-user-pool-client',
            generateSecret: false,
            authFlows: {
                userSrp: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                callbackUrls: [FRONTEND_CALLBACK_URL],
                logoutUrls: [FRONTEND_ORIGIN],
                scopes: [
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.PROFILE,
                ],
            },
            preventUserExistenceErrors: true,
            supportedIdentityProviders: [
                cognito.UserPoolClientIdentityProvider.COGNITO,
            ],
        });

        const userPoolDomain = userPool.addDomain('GrapeScrapeManagedLoginDomain', {
            customDomain: {
                domainName: AUTH_DOMAIN_NAME,
                certificate: authCertificate,
            },
            managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
        });

        const managedLoginBranding = new cognito.CfnManagedLoginBranding(
            this,
            'GrapeScrapeManagedLoginBranding',
            {
                clientId: userPoolClient.userPoolClientId,
                useCognitoProvidedValues: true,
                userPoolId: userPool.userPoolId,
            },
        );
        managedLoginBranding.node.addDependency(userPoolDomain);

        const apiCertificate = new certificatemanager.Certificate(this, 'ApiCertificate', {
            domainName: API_DOMAIN_NAME,
            certificateName: 'grapescrape-api-domain',
            validation: certificatemanager.CertificateValidation.fromDns(),
        });

        const apiDomain = new apigatewayv2.DomainName(this, 'ApiDomain', {
            domainName: API_DOMAIN_NAME,
            certificate: apiCertificate,
            endpointType: apigatewayv2.EndpointType.REGIONAL,
            securityPolicy: apigatewayv2.SecurityPolicy.TLS_1_2,
        });

        const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
            'GrapeScrapeJwtAuthorizer',
            userPool.userPoolProviderUrl,
            {
                authorizerName: 'grapescrape-cognito-jwt-authorizer',
                jwtAudience: [userPoolClient.userPoolClientId],
            },
        );

        const httpApi = new apigatewayv2.HttpApi(this, 'GrapeScrapeHttpApi', {
            apiName: 'grapescrape-api',
            description: 'Authenticated GrapeScrape domain API.',
            corsPreflight: {
                allowHeaders: ['Authorization', 'Content-Type'],
                allowMethods: [
                    apigatewayv2.CorsHttpMethod.DELETE,
                    apigatewayv2.CorsHttpMethod.GET,
                    apigatewayv2.CorsHttpMethod.PATCH,
                    apigatewayv2.CorsHttpMethod.POST,
                    apigatewayv2.CorsHttpMethod.PUT,
                ],
                allowOrigins: [FRONTEND_ORIGIN],
                exposeHeaders: ['Retry-After'],
                maxAge: Duration.days(1),
            },
            defaultAuthorizer: jwtAuthorizer,
            defaultDomainMapping: {
                domainName: apiDomain,
            },
            disableExecuteApiEndpoint: true,
        });

        const authenticatedSubjectFunction = new NodejsFunction(this, 'AuthenticatedSubjectFunction', {
            functionName: 'grapescrape-authenticated-subject',
            runtime: lambda.Runtime.NODEJS_24_X,
            architecture: lambda.Architecture.ARM_64,
            entry: path.join(__dirname, '../../src/api/authenticatedSubject.js'),
            handler: 'handler',
            memorySize: 128,
            timeout: Duration.seconds(5),
        });

        httpApi.addRoutes({
            path: '/v1/auth/session',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration(
                'AuthenticatedSubjectIntegration',
                authenticatedSubjectFunction,
            ),
        });

        const userDataTable = new dynamodb.Table(this, 'UserDataTable', {
            tableName: 'grapescrape-user-data',
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.RETAIN,
        });

        const palateProfileFunction = new NodejsFunction(this, 'PalateProfileFunction', {
            functionName: 'grapescrape-palate-profile-api',
            runtime: lambda.Runtime.NODEJS_24_X,
            architecture: lambda.Architecture.ARM_64,
            entry: path.join(__dirname, '../../src/api/palateProfile.js'),
            handler: 'handler',
            memorySize: 128,
            timeout: Duration.seconds(5),
            environment: {
                USER_DATA_TABLE_NAME: userDataTable.tableName,
            },
        });

        palateProfileFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:GetItem'],
            resources: [userDataTable.tableArn],
        }));
        palateProfileFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
            ],
            resources: [userDataTable.tableArn],
            conditions: {
                StringEquals: {
                    'dynamodb:EnclosingOperation': 'TransactWriteItems',
                },
            },
        }));

        httpApi.addRoutes({
            path: '/v1/palate-profile',
            methods: [
                apigatewayv2.HttpMethod.GET,
                apigatewayv2.HttpMethod.PUT,
            ],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration(
                'PalateProfileIntegration',
                palateProfileFunction,
            ),
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

        new CfnOutput(this, 'ApiBaseUrl', {
            description: 'Public base URL for the GrapeScrape API.',
            value: `https://${API_DOMAIN_NAME}`,
        });

        new CfnOutput(this, 'ApiCertificateArn', {
            description: 'ACM certificate for the API custom domain in eu-west-2.',
            value: apiCertificate.certificateArn,
        });

        new CfnOutput(this, 'ApiDnsTarget', {
            description: 'DNS target for api.grapescrape.com.',
            value: apiDomain.regionalDomainName,
        });

        new CfnOutput(this, 'ApiDnsTargetHostedZoneId', {
            description: 'Route 53 hosted zone ID for the regional API Gateway domain.',
            value: apiDomain.regionalHostedZoneId,
        });

        new CfnOutput(this, 'AuthDnsTarget', {
            description: 'DNS target for auth.grapescrape.com.',
            value: userPoolDomain.cloudFrontEndpoint,
        });

        new CfnOutput(this, 'AuthDomain', {
            description: 'Public Cognito managed-login domain for frontend configuration.',
            value: `https://${AUTH_DOMAIN_NAME}`,
        });

        new CfnOutput(this, 'UserPoolClientId', {
            description: 'Public Cognito app-client ID for frontend configuration.',
            value: userPoolClient.userPoolClientId,
        });

        new CfnOutput(this, 'UserPoolId', {
            description: 'Public Cognito user-pool ID for frontend configuration.',
            value: userPool.userPoolId,
        });
    }
}
