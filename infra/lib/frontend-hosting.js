import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { buildFrontendRequestFunctionCode } from './frontend-request-function.js';

const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://api.grapescrape.com https://auth.grapescrape.com https://cognito-idp.eu-west-2.amazonaws.com",
    "font-src 'self' https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'upgrade-insecure-requests',
].join('; ');

export class FrontendHosting extends Construct {
    constructor(scope, id, {
        appDomainName,
        certificate,
        rootDomainName,
    }) {
        super(scope, id);

        const bucket = new s3.Bucket(this, 'Bucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            removalPolicy: RemovalPolicy.RETAIN,
            versioned: true,
        });

        const frontendRequestFunction = new cloudfront.Function(
            this,
            'RequestFunction',
            {
                code: cloudfront.FunctionCode.fromInline(
                    buildFrontendRequestFunctionCode({
                        appDomainName,
                        rootDomainName,
                    }),
                ),
                comment: 'Redirect the apex domain and serve extensionless SPA routes.',
                runtime: cloudfront.FunctionRuntime.JS_2_0,
            },
        );

        const securityHeaders = new cloudfront.ResponseHeadersPolicy(
            this,
            'SecurityHeaders',
            {
                comment: 'GrapeScrape frontend security headers.',
                responseHeadersPolicyName: 'grapescrape-frontend-security-headers',
                securityHeadersBehavior: {
                    contentSecurityPolicy: {
                        contentSecurityPolicy: CONTENT_SECURITY_POLICY,
                        override: true,
                    },
                    contentTypeOptions: { override: true },
                    frameOptions: {
                        frameOption: cloudfront.HeadersFrameOption.DENY,
                        override: true,
                    },
                    referrerPolicy: {
                        referrerPolicy:
                            cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                        override: true,
                    },
                    strictTransportSecurity: {
                        accessControlMaxAge: Duration.days(365),
                        includeSubdomains: true,
                        override: true,
                        preload: true,
                    },
                },
            },
        );

        const origin = origins.S3BucketOrigin.withOriginAccessControl(bucket);
        const commonBehavior = {
            allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            compress: true,
            functionAssociations: [{
                eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                function: frontendRequestFunction,
            }],
            responseHeadersPolicy: securityHeaders,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        };

        const distribution = new cloudfront.Distribution(this, 'Distribution', {
            certificate,
            defaultBehavior: {
                ...commonBehavior,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                origin,
            },
            defaultRootObject: 'index.html',
            domainNames: [appDomainName, rootDomainName],
            enableIpv6: true,
            httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        });

        distribution.addBehavior('assets/*', origin, {
            ...commonBehavior,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        });

        const bucketNameOutput = new CfnOutput(this, 'BucketName', {
            description: 'Private S3 bucket for built frontend assets.',
            value: bucket.bucketName,
        });
        bucketNameOutput.overrideLogicalId('FrontendBucketName');

        const distributionIdOutput = new CfnOutput(this, 'DistributionId', {
            description: 'CloudFront distribution ID for frontend invalidations.',
            value: distribution.distributionId,
        });
        distributionIdOutput.overrideLogicalId('FrontendDistributionId');

        const distributionDomainOutput = new CfnOutput(
            this,
            'DistributionDomainName',
            {
                description: 'DNS alias target for app.grapescrape.com and grapescrape.com.',
                value: distribution.distributionDomainName,
            },
        );
        distributionDomainOutput.overrideLogicalId('FrontendDistributionDomainName');

        const distributionHostedZoneOutput = new CfnOutput(
            this,
            'DistributionHostedZoneId',
            {
                description: 'CloudFront hosted-zone ID for Route 53 alias records.',
                value: 'Z2FDTNDATAQYW2',
            },
        );
        distributionHostedZoneOutput.overrideLogicalId('FrontendDistributionHostedZoneId');

        this.bucket = bucket;
        this.distribution = distribution;
    }
}
