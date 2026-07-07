#!/usr/bin/env node

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { palateProfile } from '../old/src/assess/palateProfile.js';

const PALATE_PROFILE_VERSION = 1;
const PALATE_PROFILE_SK = `PALATE_PROFILE#${ PALATE_PROFILE_VERSION }`;
const CURRENT_POINTER_SK = 'CURRENT_PALATE_PROFILE';

const buildUserDataItems = ({ userId, seedTime, legacyPalateProfile }) => {
    const pk = `USER#${ userId }`;

    return {
        palateProfileItem: {
            pk,
            sk: PALATE_PROFILE_SK,
            entityType: 'PalateProfile',
            userId,
            palateProfileVersion: PALATE_PROFILE_VERSION,
            palateProfile: legacyPalateProfile,
            createdAt: seedTime,
            updatedAt: seedTime,
            isCurrent: true,
        },
        currentPointerItem: {
            pk,
            sk: CURRENT_POINTER_SK,
            entityType: 'CurrentPalateProfilePointer',
            userId,
            palateProfileVersion: PALATE_PROFILE_VERSION,
            palateProfileSk: PALATE_PROFILE_SK,
            updatedAt: seedTime,
        },
    };
};

const parseArgs = argv => {
    const options = {
        execute: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--execute') {
            options.execute = true;
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }

        if (arg === '--user-id' || arg === '--table-name' || arg === '--region') {
            const value = argv[index + 1];

            if (!value || value.startsWith('--')) {
                throw new Error(`${ arg } requires a value`);
            }

            options[arg.slice(2).replaceAll('-', '_')] = value;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${ arg }`);
    }

    return options;
};

const validateOptions = ({ user_id: userId, table_name: tableName, region }) => {
    const missing = [];

    if (!userId) missing.push('--user-id');
    if (!tableName) missing.push('--table-name');
    if (!region) missing.push('--region');

    if (missing.length > 0) {
        throw new Error(`Missing required arguments: ${ missing.join(', ') }`);
    }
};

const printUsage = () => {
    console.log(`Usage:
node scripts/seedLegacyPalateProfile.js \\
  --table-name <UserData table name> \\
  --region <AWS region> \\
  --user-id <Cognito user sub> \\
  [--execute]

Dry-run is the default. Add --execute to write the two UserData records.`);
};

const printSummary = ({ mode, tableName, region, userId, seedTime, items }) => {
    const profileKeys = Object.keys(items.palateProfileItem.palateProfile ?? {});

    console.log(`${ mode } legacy palate profile seed`);
    console.log(`Target table: ${ tableName }`);
    console.log(`Target region: ${ region }`);
    console.log(`User ID: ${ userId }`);
    console.log(`Seed timestamp: ${ seedTime }`);
    console.log(`Palate profile version: ${ PALATE_PROFILE_VERSION }`);
    console.log('Records:');
    console.log(`- ${ items.palateProfileItem.pk } / ${ items.palateProfileItem.sk } (${ items.palateProfileItem.entityType })`);
    console.log(`- ${ items.currentPointerItem.pk } / ${ items.currentPointerItem.sk } (${ items.currentPointerItem.entityType })`);
    console.log(`Legacy palateProfile summary: ${ profileKeys.length } top-level fields (${ profileKeys.join(', ') })`);
};

const writeItems = async ({ tableName, region, items }) => {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
        marshallOptions: {
            removeUndefinedValues: true,
        },
    });

    await client.send(new TransactWriteCommand({
        TransactItems: [
            {
                Put: {
                    TableName: tableName,
                    Item: items.palateProfileItem,
                    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                },
            },
            {
                Put: {
                    TableName: tableName,
                    Item: items.currentPointerItem,
                    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
                },
            },
        ],
    }));
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printUsage();
        return;
    }

    validateOptions(options);

    const userId = options.user_id;
    const tableName = options.table_name;
    const region = options.region;
    const seedTime = new Date().toISOString();
    const items = buildUserDataItems({
        userId,
        seedTime,
        legacyPalateProfile: palateProfile,
    });
    const mode = options.execute ? 'EXECUTE' : 'DRY-RUN';

    printSummary({ mode, tableName, region, userId, seedTime, items });

    if (!options.execute) {
        console.log('No DynamoDB writes performed. Add --execute to write these records.');
        return;
    }

    try {
        await writeItems({ tableName, region, items });
        console.log('Wrote both UserData records successfully.');
    } catch (error) {
        if (error.name === 'TransactionCanceledException') {
            throw new Error(
                'DynamoDB transaction was cancelled. Existing palate profile records were not overwritten; check whether the target keys already exist.'
            );
        }

        throw error;
    }
};

main().catch(error => {
    console.error(`Seed failed: ${ error.message }`);
    process.exitCode = 1;
});
