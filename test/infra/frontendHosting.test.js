import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import { describe, expect, it } from 'vitest';
import { FrontendHosting } from '../../infra/lib/frontend-hosting.js';
import { GrapeScrapeFutureStack } from '../../infra/lib/grapescrape-stack.js';

function frontendTemplate() {
    const app = new App();
    const stack = new Stack(app, 'FrontendHostingTest', {
        env: {
            account: '123456789012',
            region: 'eu-west-2',
        },
    });
    const certificate = certificatemanager.Certificate.fromCertificateArn(
        stack,
        'Certificate',
        'arn:aws:acm:us-east-1:123456789012:certificate/example',
    );

    new FrontendHosting(stack, 'Frontend', {
        appDomainName: 'app.grapescrape.com',
        certificate,
        rootDomainName: 'grapescrape.com',
    });

    return Template.fromStack(stack);
}

function futureStackTemplate() {
    const app = new App();
    const certificateStack = new Stack(app, 'CertificateImports', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
    });
    const authCertificate = certificatemanager.Certificate.fromCertificateArn(
        certificateStack,
        'AuthCertificate',
        'arn:aws:acm:us-east-1:123456789012:certificate/auth',
    );
    const frontendCertificate = certificatemanager.Certificate.fromCertificateArn(
        certificateStack,
        'FrontendCertificate',
        'arn:aws:acm:us-east-1:123456789012:certificate/frontend',
    );
    const stack = new GrapeScrapeFutureStack(app, 'GrapeScrapeFutureStackTest', {
        authCertificate,
        crossRegionReferences: true,
        env: {
            account: '123456789012',
            region: 'eu-west-2',
        },
        frontendCertificate,
    });

    return Template.fromStack(stack);
}

describe('frontend hosting infrastructure', () => {
    it('registers the exact production Cognito callback and logout URLs', () => {
        const template = futureStackTemplate();

        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
            CallbackURLs: ['https://app.grapescrape.com/auth/callback'],
            LogoutURLs: ['https://app.grapescrape.com/'],
        });
    });

    it('uses custom managed-login settings with the branded assets', () => {
        const template = futureStackTemplate();
        const branding = Object.values(
            template.findResources('AWS::Cognito::ManagedLoginBranding'),
        )[0].Properties;

        expect(branding).toMatchObject({
            Assets: [
                expect.objectContaining({
                    Category: 'FORM_LOGO',
                    ColorMode: 'DYNAMIC',
                    Extension: 'SVG',
                }),
                expect.objectContaining({
                    Category: 'FAVICON_SVG',
                    ColorMode: 'DYNAMIC',
                    Extension: 'SVG',
                }),
            ],
            Settings: {},
        });
        expect(branding).not.toHaveProperty('UseCognitoProvidedValues');
    });

    it('keeps the versioned asset bucket private and retained', () => {
        const template = frontendTemplate();

        template.hasResourceProperties('AWS::S3::Bucket', {
            BucketEncryption: {
                ServerSideEncryptionConfiguration: [{
                    ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
                }],
            },
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true,
                BlockPublicPolicy: true,
                IgnorePublicAcls: true,
                RestrictPublicBuckets: true,
            },
            VersioningConfiguration: { Status: 'Enabled' },
        });

        const buckets = template.findResources('AWS::S3::Bucket');
        expect(Object.values(buckets)).toHaveLength(1);
        expect(Object.values(buckets)[0]).toMatchObject({
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
        });
        template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    });

    it('configures app and apex names with separate SPA and hashed-asset caching', () => {
        const template = frontendTemplate();
        const distributions = template.findResources('AWS::CloudFront::Distribution');
        const distribution = Object.values(distributions)[0].Properties.DistributionConfig;

        expect(distribution.Aliases).toEqual([
            'app.grapescrape.com',
            'grapescrape.com',
        ]);
        expect(distribution.DefaultCacheBehavior.CachePolicyId).toBe(
            '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        );
        expect(distribution.CacheBehaviors).toEqual([
            expect.objectContaining({
                CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
                PathPattern: 'assets/*',
            }),
        ]);
        expect(distribution.Origins[0]).toMatchObject({
            OriginAccessControlId: expect.anything(),
            S3OriginConfig: { OriginAccessIdentity: '' },
        });
    });

    it('applies the OAuth-compatible CSP and transport headers', () => {
        const template = frontendTemplate();
        const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
        const policy = Object.values(policies)[0].Properties.ResponseHeadersPolicyConfig;
        const security = policy.SecurityHeadersConfig;

        expect(security.ContentSecurityPolicy.ContentSecurityPolicy).toContain(
            "connect-src 'self' https://api.grapescrape.com https://auth.grapescrape.com https://cognito-idp.eu-west-2.amazonaws.com",
        );
        expect(security.ContentSecurityPolicy.ContentSecurityPolicy).toContain(
            "style-src 'self' https://fonts.googleapis.com",
        );
        expect(security.ContentSecurityPolicy.ContentSecurityPolicy).toContain(
            "font-src 'self' https://fonts.gstatic.com",
        );
        expect(security.StrictTransportSecurity).toMatchObject({
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
            Override: true,
            Preload: true,
        });
    });
});
