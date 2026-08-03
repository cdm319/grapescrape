import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const PROHIBITED_BUILD_PATTERNS = [
    { label: 'prototype archives', matches: (file) => file.endsWith('.zip') },
    { label: 'generated prototype HTML', matches: (file) => file.endsWith('.dc.html') },
    { label: 'prototype support code', matches: (file) => path.basename(file) === 'support.js' },
    { label: 'prototype screenshots', matches: (file) => file.split('/').includes('screenshots') },
    { label: 'simulator artifacts', matches: (file) => file.toLowerCase().includes('simulator') },
];

const AWS_EXCLUDES = [
    '--exclude', '*.zip',
    '--exclude', '*.dc.html',
    '--exclude', 'support.js',
    '--exclude', 'screenshots/*',
    '--exclude', '*simulator*',
];

const PUBLIC_FRONTEND_VARIABLES = [
    'VITE_API_BASE_URL',
    'VITE_COGNITO_AUTH_DOMAIN',
    'VITE_COGNITO_REGION',
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_CLIENT_ID',
    'VITE_COGNITO_CALLBACK_URL',
    'VITE_COGNITO_LOGOUT_URL',
];

const VITE_PRODUCTION_ENVIRONMENT_FILES = [
    'src/ui/.env',
    'src/ui/.env.local',
    'src/ui/.env.production',
    'src/ui/.env.production.local',
];

export function assertSafeFrontendBuildFiles(files) {
    const unsafe = files.filter((file) =>
        PROHIBITED_BUILD_PATTERNS.some(({ matches }) => matches(file)),
    );

    if (unsafe.length > 0) {
        throw new Error(
            `Refusing to publish prohibited frontend artifacts: ${unsafe.join(', ')}`,
        );
    }
}

export function buildFrontendDeploymentCommands({
    bucketName,
    distributionId,
    execute,
}) {
    const dryRunArguments = execute ? [] : ['--dryrun'];
    const bucketUri = `s3://${bucketName}`;

    return [
        {
            command: 'aws',
            arguments: [
                's3', 'sync', 'src/ui/dist', bucketUri,
                '--delete',
                '--exclude', 'assets/*',
                ...AWS_EXCLUDES,
                '--cache-control', 'no-cache, no-store, must-revalidate',
                ...dryRunArguments,
            ],
        },
        {
            command: 'aws',
            arguments: [
                's3', 'sync', 'src/ui/dist/assets', `${bucketUri}/assets`,
                '--delete',
                ...AWS_EXCLUDES,
                '--cache-control', 'public, max-age=31536000, immutable',
                ...dryRunArguments,
            ],
        },
        {
            command: 'aws',
            arguments: [
                'cloudfront', 'create-invalidation',
                '--distribution-id', distributionId,
                '--paths', '/index.html',
            ],
            executeOnly: true,
        },
    ];
}

export function parsePublicFrontendEnvironmentFile(contents) {
    const environment = {};

    for (const sourceLine of contents.split(/\r?\n/)) {
        const line = sourceLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!match) {
            throw new Error(`Invalid production environment line: ${sourceLine}`);
        }

        const [, name, sourceValue] = match;
        let value = sourceValue.trim();
        if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'")))
        ) {
            value = value.slice(1, -1);
        }
        environment[name] = value;
    }

    return environment;
}

export function assertSafePublicFrontendConfiguration(environment) {
    const viteNames = Object.keys(environment).filter((name) =>
        name.startsWith('VITE_'),
    );
    const unexpected = viteNames.filter(
        (name) => !PUBLIC_FRONTEND_VARIABLES.includes(name),
    );
    if (unexpected.length > 0) {
        throw new Error(
            `Unexpected public frontend variable: ${unexpected.join(', ')}`,
        );
    }

    const missing = PUBLIC_FRONTEND_VARIABLES.filter(
        (name) => !environment[name]?.trim(),
    );
    if (missing.length > 0) {
        throw new Error(`Missing public frontend variable: ${missing.join(', ')}`);
    }

    const placeholders = PUBLIC_FRONTEND_VARIABLES.filter((name) =>
        environment[name].includes('REPLACE_WITH'),
    );
    if (placeholders.length > 0) {
        throw new Error(
            `Replace placeholder public frontend variable: ${placeholders.join(', ')}`,
        );
    }

    const expectedValues = {
        VITE_API_BASE_URL: 'https://api.grapescrape.com',
        VITE_COGNITO_AUTH_DOMAIN: 'https://auth.grapescrape.com',
        VITE_COGNITO_CALLBACK_URL:
            'https://app.grapescrape.com/auth/callback',
        VITE_COGNITO_LOGOUT_URL: 'https://app.grapescrape.com/',
        VITE_COGNITO_REGION: 'eu-west-2',
    };
    for (const [name, expected] of Object.entries(expectedValues)) {
        if (environment[name] !== expected) {
            throw new Error(`${name} must be ${expected}`);
        }
    }

    if (!/^eu-west-2_[A-Za-z0-9]+$/.test(environment.VITE_COGNITO_USER_POOL_ID)) {
        throw new Error('Invalid VITE_COGNITO_USER_POOL_ID');
    }
    if (!/^[A-Za-z0-9]+$/.test(environment.VITE_COGNITO_CLIENT_ID)) {
        throw new Error('Invalid VITE_COGNITO_CLIENT_ID');
    }
}

function listFiles(directory, relativeDirectory = '') {
    const files = [];

    for (const entry of readdirSync(path.join(directory, relativeDirectory), {
        withFileTypes: true,
    })) {
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(directory, relativePath));
        } else {
            files.push(relativePath);
        }
    }

    return files;
}

function run(command, arguments_, { printOnly = false } = {}) {
    const display = [command, ...arguments_].join(' ');
    if (printOnly) {
        console.log(`[dry-run] ${display}`);
        return;
    }

    const result = spawnSync(command, arguments_, {
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(`Command failed: ${display}`);
    }
}

function requiredEnvironment(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function main() {
    const unknownArguments = process.argv.slice(2).filter(
        (argument) => argument !== '--execute',
    );
    if (unknownArguments.length > 0) {
        throw new Error(`Unknown argument: ${unknownArguments[0]}`);
    }

    const execute = process.argv.includes('--execute');
    const bucketName = requiredEnvironment('GRAPESCRAPE_FRONTEND_BUCKET');
    const distributionId = requiredEnvironment(
        'GRAPESCRAPE_FRONTEND_DISTRIBUTION_ID',
    );

    const publicEnvironment = {};
    for (const environmentFile of VITE_PRODUCTION_ENVIRONMENT_FILES) {
        if (existsSync(environmentFile)) {
            Object.assign(
                publicEnvironment,
                parsePublicFrontendEnvironmentFile(
                    readFileSync(environmentFile, 'utf8'),
                ),
            );
        }
    }
    for (const name of Object.keys(process.env).filter((key) => key.startsWith('VITE_'))) {
        publicEnvironment[name] = process.env[name];
    }
    assertSafePublicFrontendConfiguration(publicEnvironment);

    run('npm', ['--workspace', '@grapescrape/ui', 'run', 'build']);
    assertSafeFrontendBuildFiles(listFiles('src/ui/dist'));

    for (const deploymentCommand of buildFrontendDeploymentCommands({
        bucketName,
        distributionId,
        execute,
    })) {
        run(deploymentCommand.command, deploymentCommand.arguments, {
            printOnly: !execute && deploymentCommand.executeOnly,
        });
    }

    console.log(
        execute
            ? 'Frontend assets uploaded and /index.html invalidated.'
            : 'Dry run complete. Re-run with --execute to upload and invalidate.',
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
