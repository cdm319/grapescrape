import { describe, expect, it } from 'vitest';
import {
    assertSafePublicFrontendConfiguration,
    assertSafeFrontendBuildFiles,
    buildFrontendDeploymentCommands,
    parsePublicFrontendEnvironmentFile,
} from '../../scripts/deployFrontendAssets.js';

const publicConfiguration = {
    VITE_API_BASE_URL: 'https://api.grapescrape.com',
    VITE_COGNITO_AUTH_DOMAIN: 'https://auth.grapescrape.com',
    VITE_COGNITO_REGION: 'eu-west-2',
    VITE_COGNITO_USER_POOL_ID: 'eu-west-2_example123',
    VITE_COGNITO_CLIENT_ID: 'publicclient123',
    VITE_COGNITO_CALLBACK_URL: 'https://app.grapescrape.com/auth/callback',
    VITE_COGNITO_LOGOUT_URL: 'https://app.grapescrape.com/',
};

describe('frontend asset deployment safety', () => {
    it('accepts only the seven expected public production variables', () => {
        expect(() => assertSafePublicFrontendConfiguration(publicConfiguration))
            .not.toThrow();
        expect(() => assertSafePublicFrontendConfiguration({
            ...publicConfiguration,
            VITE_CLIENT_SECRET: 'must-not-be-public',
        })).toThrow('Unexpected public frontend variable');
    });

    it('rejects placeholder identifiers and parses an environment file safely', () => {
        const parsed = parsePublicFrontendEnvironmentFile(
            '# public values\nVITE_COGNITO_REGION=eu-west-2\nVITE_API_BASE_URL="https://api.grapescrape.com"\n',
        );
        expect(parsed).toEqual({
            VITE_API_BASE_URL: 'https://api.grapescrape.com',
            VITE_COGNITO_REGION: 'eu-west-2',
        });
        expect(() => assertSafePublicFrontendConfiguration({
            ...publicConfiguration,
            VITE_COGNITO_CLIENT_ID: 'REPLACE_WITH_STACK_OUTPUT',
        })).toThrow('Replace placeholder public frontend variable');
    });

    it.each([
        'grapescrape_prototype.zip',
        'GrapeScrape.dc.html',
        'support.js',
        'screenshots/home.png',
        'assets/state-simulator.json',
    ])('rejects prohibited artifact %s', (file) => {
        expect(() => assertSafeFrontendBuildFiles(['index.html', file]))
            .toThrow('Refusing to publish prohibited frontend artifacts');
    });

    it('accepts the built entry point, branded assets and hashed bundles', () => {
        expect(() => assertSafeFrontendBuildFiles([
            'index.html',
            'grapescrape-logo.svg',
            'grapescrape-mark.svg',
            'assets/index-abc123.js',
            'assets/index-def456.css',
        ])).not.toThrow();
    });

    it('dry-runs every upload in dependency-safe order without invalidating', () => {
        const commands = buildFrontendDeploymentCommands({
            bucketName: 'frontend-bucket',
            distributionId: 'DISTRIBUTION',
            execute: false,
        });

        expect(commands.map(({ arguments: arguments_ }) => arguments_.slice(0, 4)))
            .toEqual([
                ['s3', 'sync', 'src/ui/dist/assets', 's3://frontend-bucket/assets'],
                ['s3', 'sync', 'src/ui/dist', 's3://frontend-bucket'],
                ['s3', 'cp', 'src/ui/dist/index.html', 's3://frontend-bucket/index.html'],
            ]);
        expect(commands.every(({ arguments: arguments_ }) =>
            arguments_.includes('--dryrun'))).toBe(true);
        expect(commands.some(({ arguments: arguments_ }) =>
            arguments_[0] === 'cloudfront')).toBe(false);
        expect(commands[1].arguments).toEqual(expect.arrayContaining([
            '--exclude',
            'assets/*',
            'index.html',
        ]));
        expect(commands[1].arguments[
            commands[1].arguments.indexOf('index.html') - 1
        ]).toBe('--exclude');
        expect(commands.every(({ arguments: arguments_ }) =>
            !arguments_.includes('--delete'))).toBe(true);
    });

    it('publishes index last and then invalidates only index on execution', () => {
        const commands = buildFrontendDeploymentCommands({
            bucketName: 'frontend-bucket',
            distributionId: 'DISTRIBUTION',
            execute: true,
        });

        expect(commands[2].arguments.slice(0, 4)).toEqual([
            's3',
            'cp',
            'src/ui/dist/index.html',
            's3://frontend-bucket/index.html',
        ]);
        expect(commands[3].arguments).toEqual([
            'cloudfront', 'create-invalidation',
            '--distribution-id', 'DISTRIBUTION',
            '--paths', '/index.html',
        ]);
    });

    it('sets immutable cache control only on hashed asset uploads', () => {
        const commands = buildFrontendDeploymentCommands({
            bucketName: 'frontend-bucket',
            distributionId: 'DISTRIBUTION',
            execute: true,
        });

        expect(commands[0].arguments).toContain('public, max-age=31536000, immutable');
        expect(commands[1].arguments).toContain('no-cache, no-store, must-revalidate');
        expect(commands[2].arguments).toContain('no-cache, no-store, must-revalidate');
        expect(commands.slice(0, 3).every(({ arguments: arguments_ }) =>
            !arguments_.includes('--dryrun'))).toBe(true);
        expect(commands.every(({ arguments: arguments_ }) =>
            !arguments_.includes('--delete'))).toBe(true);
    });
});
