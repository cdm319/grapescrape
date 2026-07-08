#!/usr/bin/env node

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';

const SAMPLE_SIZE = 3;

const parseArgs = argv => {
    const options = {
        execute: false,
        skipInvalid: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--execute') {
            options.execute = true;
            continue;
        }

        if (arg === '--skip-invalid') {
            options.skipInvalid = true;
            continue;
        }

        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }

        if ([
            '--bucket',
            '--key',
            '--assessments-table-name',
            '--wine-stock-table-name',
            '--user-id',
            '--retailer-id',
            '--region',
        ].includes(arg)) {
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

const validateOptions = options => {
    const missing = [];

    if (!options.bucket) missing.push('--bucket');
    if (!options.key) missing.push('--key');
    if (!options.assessments_table_name) missing.push('--assessments-table-name');
    if (!options.wine_stock_table_name) missing.push('--wine-stock-table-name');
    if (!options.user_id) missing.push('--user-id');
    if (!options.retailer_id) missing.push('--retailer-id');
    if (!options.region) missing.push('--region');

    if (missing.length > 0) {
        throw new Error(`Missing required arguments: ${ missing.join(', ') }`);
    }
};

const printUsage = () => {
    console.log(`Usage:
node scripts/migrateAssessmentsToDynamo.js \\
  --bucket <legacy-state-bucket> \\
  --key <path/to/assessments.json> \\
  --assessments-table-name <Assessments table name> \\
  --wine-stock-table-name <WineStock table name> \\
  --user-id <Cognito user id> \\
  --retailer-id <retailer id> \\
  --region <AWS region> \\
  [--execute] \\
  [--skip-invalid]

Dry-run is the default. Add --execute to write completed assessment records.
Execute mode refuses duplicate assessment keys. Execute mode also refuses invalid records unless --skip-invalid is set.
Do not use --execute until the dry-run summary has been reviewed.`);
};

const isPlainObject = value =>
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasNonBlankValue = value => value !== undefined && value !== null && String(value).trim() !== '';

const normalizeCreatedAt = value => {
    if (value === undefined || value === null || value === '') return undefined;

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return undefined;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;

        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const milliseconds = Number(trimmed);
            if (!Number.isFinite(milliseconds)) return undefined;
            const numericDate = new Date(milliseconds);
            return Number.isNaN(numericDate.getTime()) ? undefined : numericDate.toISOString();
        }

        const date = new Date(trimmed);
        return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }

    return undefined;
};

const createAssessmentInputKey = ({
    userId,
    sourceKey,
    palateProfileVersion,
    assessmentVersion,
    sourceHash,
}) => createHash('sha256')
    .update(JSON.stringify({
        userId,
        sourceKey,
        palateProfileVersion,
        assessmentVersion,
        sourceHash,
    }))
    .digest('hex');

const parseLegacyAssessments = sourceJson => {
    let parsed;

    try {
        parsed = JSON.parse(sourceJson);
    } catch (error) {
        throw new Error(`S3 object did not parse as JSON: ${ error.message }`);
    }

    if (!isPlainObject(parsed)) {
        throw new Error('S3 object JSON must have a top-level object keyed by legacy wine ID');
    }

    return parsed;
};

const getWineId = (legacyKey, legacy) => {
    if (hasNonBlankValue(legacyKey)) return String(legacyKey).trim();
    if (hasNonBlankValue(legacy?.wine?.id)) return String(legacy.wine.id).trim();
    return undefined;
};

const hasUsableLegacyWineSnapshot = (legacyWine, wineId) =>
    isPlainObject(legacyWine) && hasNonBlankValue(legacyWine.id ?? wineId);

const createWineSnapshotFromLegacy = ({ legacyWine, wineId, sourceHash }) => ({
    id: legacyWine.id ?? wineId,
    name: legacyWine.name,
    region: legacyWine.region,
    vintage: legacyWine.vintage,
    price: legacyWine.price,
    grape: legacyWine.grape,
    alcohol: legacyWine.alcohol,
    description: legacyWine.description ?? legacyWine.desc,
    sourceHash,
    rawPayload: legacyWine,
});

const createWineSnapshotFromWineStock = ({ item, wineId, sourceHash }) => ({
    id: item.id ?? wineId,
    name: item.name,
    region: item.region,
    vintage: item.vintage,
    price: item.price,
    grape: item.grape,
    alcohol: item.alcohol,
    description: item.description,
    sourceHash,
    rawPayload: item.rawPayload ?? item,
});

const getWineStockListing = async ({ client, tableName, retailerId, wineId }) => {
    const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: {
            pk: `RETAILER#${ retailerId }`,
            sk: `LISTING#${ wineId }`,
        },
    }));

    return result.Item;
};

const createAssessmentItem = ({
    userId,
    retailerId,
    wineId,
    legacy,
    wineSnapshot,
    wineStockSourceHash,
    createdAt,
    migratedAt,
}) => {
    const sourceKey = `retailer:${ retailerId }:${ wineId }`;
    const assessmentVersion = legacy.assessmentVersion ?? 1;
    const palateProfileVersion = legacy.palateProfileVersion ?? 1;
    const sourceHash = legacy.sourceHash;
    const assessmentInputKey = createAssessmentInputKey({
        userId,
        sourceKey,
        palateProfileVersion,
        assessmentVersion,
        sourceHash,
    });

    return {
        pk: `USER#${ userId }`,
        sk: `ASSESSMENT#${ assessmentInputKey }`,
        entityType: 'Assessment',

        userId,
        assessmentInputKey,

        source: { type: 'retailer', key: sourceKey },
        sourceKey,
        retailerId,
        wineId,

        wineSnapshot,

        sourceHash,
        wineStockSourceHash,
        palateProfileVersion,
        assessmentVersion,

        status: 'completed',
        model: legacy.model,
        assessment: legacy.assessment,

        fit: legacy.assessment.fit,
        highlight: legacy.assessment.highlight,
        confidence: legacy.assessment.confidence,
        headline: legacy.assessment.headline ?? null,
        summary: legacy.assessment.summary ?? null,

        createdAt,
        completedAt: createdAt,
        migratedAt,

        legacyAssessment: legacy,

        gsi1pk: `USER#${ userId }#ASSESSMENTS`,
        gsi1sk: `CREATED#${ createdAt }#ASSESSMENT#${ assessmentInputKey }`,

        gsi2pk: `USER#${ userId }#SOURCE#${ sourceKey }`,
        gsi2sk: `CREATED#${ createdAt }#ASSESSMENT#${ assessmentInputKey }`,
    };
};

const getValidationFailures = ({ legacyKey, legacy, wineId, createdAt }) => {
    const reasons = [];

    if (!isPlainObject(legacy)) {
        return ['legacy entry must be a plain object'];
    }

    if (!hasNonBlankValue(wineId)) {
        reasons.push('no usable wineId could be derived from the object key or legacy.wine.id');
    }

    if (!hasNonBlankValue(legacy.sourceHash)) {
        reasons.push('sourceHash is required and must not be blank');
    }

    if (!isPlainObject(legacy.assessment)) {
        reasons.push('assessment is required and must be a plain object');
    }

    if (!createdAt) {
        reasons.push('createdAt is required and must be a finite epoch millisecond value, numeric string, or valid date string');
    }

    if (!hasNonBlankValue(legacyKey) && !hasNonBlankValue(legacy?.wine?.id)) {
        reasons.push('legacy key and legacy.wine.id are both missing or blank');
    }

    return reasons;
};

const createInvalidRecord = ({ legacyKey, wineId, reasons }) => ({
    legacyKey,
    wineId,
    reasons,
});

const createMigrationPlan = async ({
    sourceJson,
    userId,
    retailerId,
    wineStockTableName,
    migrationTimestamp,
    dynamoClient,
}) => {
    const legacyAssessments = parseLegacyAssessments(sourceJson);
    const entries = Object.entries(legacyAssessments);
    const invalidRecords = [];
    const fallbackJoins = [];
    const noWineSnapshotRecords = [];
    const transformedItems = [];

    for (const [legacyKey, legacy] of entries) {
        const wineId = getWineId(legacyKey, legacy);
        const createdAt = isPlainObject(legacy) ? normalizeCreatedAt(legacy.createdAt) : undefined;
        const validationFailures = getValidationFailures({ legacyKey, legacy, wineId, createdAt });

        if (validationFailures.length > 0) {
            invalidRecords.push(createInvalidRecord({
                legacyKey,
                wineId,
                reasons: validationFailures,
            }));
            continue;
        }

        let wineSnapshot;
        let wineStockSourceHash;

        if (hasUsableLegacyWineSnapshot(legacy.wine, wineId)) {
            wineSnapshot = createWineSnapshotFromLegacy({
                legacyWine: legacy.wine,
                wineId,
                sourceHash: legacy.sourceHash,
            });
        } else {
            const wineStockItem = await getWineStockListing({
                client: dynamoClient,
                tableName: wineStockTableName,
                retailerId,
                wineId,
            });

            if (wineStockItem) {
                wineStockSourceHash = wineStockItem.sourceHash;
                wineSnapshot = createWineSnapshotFromWineStock({
                    item: wineStockItem,
                    wineId,
                    sourceHash: legacy.sourceHash,
                });
                fallbackJoins.push({
                    legacyKey,
                    wineId,
                    pk: `RETAILER#${ retailerId }`,
                    sk: `LISTING#${ wineId }`,
                    wineStockSourceHash,
                });
            }
        }

        if (!wineSnapshot) {
            const record = createInvalidRecord({
                legacyKey,
                wineId,
                reasons: ['no usable wineSnapshot exists and WineStock fallback lookup did not find one'],
            });
            invalidRecords.push(record);
            noWineSnapshotRecords.push(record);
            continue;
        }

        transformedItems.push(createAssessmentItem({
            userId,
            retailerId,
            wineId,
            legacy,
            wineSnapshot,
            wineStockSourceHash,
            createdAt,
            migratedAt: migrationTimestamp,
        }));
    }

    const duplicateAssessmentKeys = getDuplicateAssessmentKeyDetails(transformedItems);

    return {
        migrationTimestamp,
        recordsRead: entries.length,
        validRecords: transformedItems.length,
        invalidRecords,
        fallbackJoins,
        noWineSnapshotRecords,
        duplicateAssessmentKeys,
        transformedItems,
        transformedItemKeys: transformedItems.map(item => ({
            pk: item.pk,
            sk: item.sk,
            assessmentInputKey: item.assessmentInputKey,
            sourceKey: item.sourceKey,
            wineId: item.wineId,
            createdAt: item.createdAt,
        })),
        sampleTransformedItems: transformedItems.slice(0, SAMPLE_SIZE),
    };
};

const getDuplicateAssessmentKeyDetails = items => {
    const recordsByKey = new Map();

    items.forEach(item => {
        const records = recordsByKey.get(item.assessmentInputKey) ?? [];
        records.push({
            assessmentInputKey: item.assessmentInputKey,
            sourceKey: item.sourceKey,
            wineId: item.wineId,
            createdAt: item.createdAt,
            pk: item.pk,
            sk: item.sk,
        });
        recordsByKey.set(item.assessmentInputKey, records);
    });

    return [...recordsByKey.values()]
        .filter(records => records.length > 1)
        .map(records => ({
            assessmentInputKey: records[0].assessmentInputKey,
            records,
        }));
};

const evaluateWriteSafety = ({ execute, skipInvalid, plan }) => {
    const reasons = [];

    if (plan.duplicateAssessmentKeys.length > 0) {
        reasons.push('duplicate generated assessment keys exist; refusing to write because assessment rows must be unique');
    }

    if (plan.invalidRecords.length > 0 && !skipInvalid) {
        reasons.push('invalid/skipped records exist; pass --skip-invalid to execute a partial migration');
    }

    return {
        mode: execute ? 'EXECUTE' : 'DRY-RUN',
        safeToWrite: reasons.length === 0,
        refusalReasons: reasons,
        recordsSkippedBySkipInvalid: skipInvalid ? plan.invalidRecords.length : 0,
        writableRecords: plan.validRecords,
    };
};

const readS3ObjectText = async ({ bucket, key, region }) => {
    const client = new S3Client({ region });
    const result = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
    }));

    if (!result.Body) {
        throw new Error('S3 object had no body');
    }

    if (typeof result.Body.transformToString === 'function') {
        return result.Body.transformToString();
    }

    const chunks = [];

    for await (const chunk of result.Body) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
};

const putAssessmentItems = async ({ client, tableName, items }) => {
    let writtenRecords = 0;

    for (const item of items) {
        try {
            await client.send(new PutCommand({
                TableName: tableName,
                Item: item,
                ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
            }));
            writtenRecords += 1;
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') {
                throw new Error(`Assessment row already exists for pk=${ item.pk } sk=${ item.sk }; refusing to overwrite`);
            }

            throw error;
        }
    }

    return { writtenRecords };
};

const printJsonBlock = value => {
    console.log(JSON.stringify(value, null, 2));
};

const printInvalidRecordDetails = records => {
    records.forEach(({ legacyKey, wineId, reasons }) => {
        const keyText = legacyKey === undefined ? 'unknown legacy key' : `legacy key ${ JSON.stringify(legacyKey) }`;
        const wineText = wineId === undefined ? 'unknown wine ID' : `wine ID ${ JSON.stringify(wineId) }`;
        console.log(`- ${ keyText }, ${ wineText }: ${ reasons.join('; ') }`);
    });
};

const printSummary = ({ options, plan, safety, writeResult }) => {
    console.log(`${ safety.mode } assessments.json to Assessments migration`);
    console.log(`Source S3 bucket: ${ options.bucket }`);
    console.log(`Source S3 key: ${ options.key }`);
    console.log(`Target Assessments table: ${ options.assessments_table_name }`);
    console.log(`WineStock table: ${ options.wine_stock_table_name }`);
    console.log(`AWS region: ${ options.region }`);
    console.log(`User ID: ${ options.user_id }`);
    console.log(`Retailer ID: ${ options.retailer_id }`);
    console.log(`Migration timestamp: ${ plan.migrationTimestamp }`);
    console.log(`Records read: ${ plan.recordsRead }`);
    console.log(`Valid records: ${ plan.validRecords }`);
    console.log(`Invalid/skipped records: ${ plan.invalidRecords.length }`);
    console.log(`Records joined from WineStock: ${ plan.fallbackJoins.length }`);
    console.log(`Records skipped because no wine snapshot could be found: ${ plan.noWineSnapshotRecords.length }`);
    console.log(`Duplicate assessment key groups: ${ plan.duplicateAssessmentKeys.length }`);

    if (safety.mode === 'EXECUTE') {
        console.log(`Records written: ${ writeResult?.writtenRecords ?? 0 }`);
    } else {
        console.log(`Records that would be written: ${ safety.writableRecords }`);
    }

    console.log(`Records skipped because of --skip-invalid: ${ safety.recordsSkippedBySkipInvalid }`);

    if (safety.refusalReasons.length > 0) {
        console.log('Write refusal reasons:');
        safety.refusalReasons.forEach(reason => console.log(`- ${ reason }`));
    }

    if (plan.duplicateAssessmentKeys.length > 0) {
        console.log('Duplicate assessment key details:');
        plan.duplicateAssessmentKeys.forEach(({ assessmentInputKey, records }) => {
            console.log(`- assessmentInputKey ${ assessmentInputKey }`);
            records.forEach(record => {
                console.log(`  - sourceKey ${ record.sourceKey }, wineId ${ record.wineId }, createdAt ${ record.createdAt }, pk ${ record.pk }, sk ${ record.sk }`);
            });
        });
    }

    if (plan.fallbackJoins.length > 0) {
        console.log('WineStock fallback join details:');
        printJsonBlock(plan.fallbackJoins);
    }

    if (plan.invalidRecords.length > 0) {
        console.log('Invalid/skipped record details:');
        printInvalidRecordDetails(plan.invalidRecords);
    }

    if (plan.transformedItemKeys.length > 0) {
        console.log('Assessment record write keys:');
        printJsonBlock(plan.transformedItemKeys);
    }

    console.log(`Sample transformed Assessments table items (${ plan.sampleTransformedItems.length }):`);
    printJsonBlock(plan.sampleTransformedItems);
};

const createDynamoDocumentClient = region => DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});

const main = async () => {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printUsage();
        return;
    }

    validateOptions(options);

    const migrationTimestamp = new Date().toISOString();
    const dynamoClient = createDynamoDocumentClient(options.region);
    const sourceJson = await readS3ObjectText({
        bucket: options.bucket,
        key: options.key,
        region: options.region,
    });
    const plan = await createMigrationPlan({
        sourceJson,
        userId: options.user_id,
        retailerId: options.retailer_id,
        wineStockTableName: options.wine_stock_table_name,
        migrationTimestamp,
        dynamoClient,
    });
    const safety = evaluateWriteSafety({
        execute: options.execute,
        skipInvalid: options.skipInvalid,
        plan,
    });

    if (!options.execute) {
        printSummary({ options, plan, safety });
        console.log('Dry-run complete. No Assessments table writes, SQS/SNS messages, OpenAI calls, or AWS resource mutations were performed.');
        return;
    }

    if (!safety.safeToWrite) {
        printSummary({ options, plan, safety });
        throw new Error('Unsafe execute request refused before writing to DynamoDB');
    }

    const writeResult = await putAssessmentItems({
        client: dynamoClient,
        tableName: options.assessments_table_name,
        items: plan.transformedItems,
    });

    printSummary({ options, plan, safety, writeResult });
    console.log('Assessment records written successfully.');
};

main().catch(error => {
    console.error(`Migration failed: ${ error.message }`);
    process.exitCode = 1;
});
