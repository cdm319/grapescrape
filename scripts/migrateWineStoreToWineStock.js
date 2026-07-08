#!/usr/bin/env node

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createSourceHash } from '@grapescrape/domain/wine/createSourceHash';
import { createWineStockStore } from '@grapescrape/state/dynamodb/wineStockStore';

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
            '--table-name',
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

const validateOptions = ({ bucket, key, table_name: tableName, retailer_id: retailerId, region }) => {
    const missing = [];

    if (!bucket) missing.push('--bucket');
    if (!key) missing.push('--key');
    if (!tableName) missing.push('--table-name');
    if (!retailerId) missing.push('--retailer-id');
    if (!region) missing.push('--region');

    if (missing.length > 0) {
        throw new Error(`Missing required arguments: ${ missing.join(', ') }`);
    }
};

const printUsage = () => {
    console.log(`Usage:
node scripts/migrateWineStoreToWineStock.js \\
  --bucket <legacy-state-bucket> \\
  --key <path/to/wineStore.json> \\
  --table-name <WineStock table name> \\
  --retailer-id <retailer id> \\
  --region <AWS region> \\
  [--execute] \\
  [--skip-invalid]

Dry-run is the default. Add --execute to write valid records to WineStock.
Execute mode refuses duplicate IDs. Execute mode also refuses invalid records unless --skip-invalid is set.`);
};

const isPlainObject = value =>
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasNonBlankValue = value => value !== undefined && value !== null && String(value).trim() !== '';

const isPriceCompatibleWithWineStock = price => {
    if (!hasNonBlankValue(price)) return false;

    const parsed = Number(price);
    return Number.isFinite(parsed);
};

const validateLegacyRecord = (record, index) => {
    const reasons = [];

    if (!isPlainObject(record)) {
        return {
            index,
            reasons: ['record must be a plain object'],
        };
    }

    if (!hasNonBlankValue(record.id)) {
        reasons.push('id is required and must not be blank');
    }

    if (!hasNonBlankValue(record.name)) {
        reasons.push('name is required and must not be blank');
    }

    if (!isPriceCompatibleWithWineStock(record.price)) {
        reasons.push('price is required and must parse as a finite number');
    }

    return reasons.length > 0
        ? { index, id: record.id, reasons }
        : null;
};

const getDuplicateIdDetails = records => {
    const indexesById = new Map();

    records.forEach((record, index) => {
        if (!isPlainObject(record) || !hasNonBlankValue(record.id)) return;

        const id = String(record.id).trim();
        const indexes = indexesById.get(id) ?? [];
        indexes.push(index);
        indexesById.set(id, indexes);
    });

    return [...indexesById.entries()]
        .filter(([, indexes]) => indexes.length > 1)
        .map(([id, indexes]) => ({ id, indexes }));
};

const transformLegacyWine = ({ legacy, migrationTimestamp }) => ({
    id: legacy.id,
    name: legacy.name,
    region: legacy.region,
    vintage: legacy.vintage,
    price: legacy.price,
    grape: legacy.grape,
    alcohol: legacy.alcohol,
    description: legacy.desc,
    sourceHash: createSourceHash({
        name: legacy.name,
        vintage: legacy.vintage,
        region: legacy.region,
        alcohol: legacy.alcohol,
    }),
    rawPayload: legacy,
    firstSeenAt: migrationTimestamp,
    lastSeenAt: migrationTimestamp,
});

const parseLegacyWineStore = sourceJson => {
    let parsed;

    try {
        parsed = JSON.parse(sourceJson);
    } catch (error) {
        throw new Error(`S3 object did not parse as JSON: ${ error.message }`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error('S3 object JSON must have a top-level array of legacy wine listing records');
    }

    return parsed;
};

const createMigrationPlan = ({ sourceJson, migrationTimestamp }) => {
    const legacyRecords = parseLegacyWineStore(sourceJson);
    const invalidRecords = legacyRecords
        .map((record, index) => validateLegacyRecord(record, index))
        .filter(Boolean);
    const invalidIndexes = new Set(invalidRecords.map(record => record.index));
    const duplicateIds = getDuplicateIdDetails(legacyRecords);
    const transformedWines = legacyRecords
        .filter((record, index) => !invalidIndexes.has(index))
        .map(legacy => transformLegacyWine({ legacy, migrationTimestamp }));

    return {
        migrationTimestamp,
        recordsRead: legacyRecords.length,
        validRecords: transformedWines.length,
        invalidRecords,
        duplicateIds,
        transformedWines,
        sampleTransformedWines: transformedWines.slice(0, SAMPLE_SIZE),
    };
};

const evaluateWriteSafety = ({ execute, skipInvalid, plan }) => {
    const reasons = [];

    if (plan.duplicateIds.length > 0) {
        reasons.push('duplicate IDs exist; refusing to write because last-write-wins would be unsafe');
    }

    if (plan.invalidRecords.length > 0 && !skipInvalid) {
        reasons.push('invalid records exist; pass --skip-invalid to write only valid records');
    }

    const safeToWrite = reasons.length === 0;
    const skippedRecords = skipInvalid ? plan.invalidRecords.length : 0;
    const writableRecords = safeToWrite ? plan.validRecords : 0;

    return {
        mode: execute ? 'EXECUTE' : 'DRY-RUN',
        safeToWrite,
        refusalReasons: reasons,
        skippedRecords,
        writableRecords,
    };
};

const printJsonBlock = value => {
    console.log(JSON.stringify(value, null, 2));
};

const printSummary = ({ options, plan, safety, writeResult }) => {
    console.log(`${ safety.mode } wineStore.json to WineStock migration`);
    console.log(`Source S3 bucket: ${ options.bucket }`);
    console.log(`Source S3 key: ${ options.key }`);
    console.log(`Target table: ${ options.table_name }`);
    console.log(`Target region: ${ options.region }`);
    console.log(`Retailer ID: ${ options.retailer_id }`);
    console.log(`Migration timestamp: ${ plan.migrationTimestamp }`);
    console.log(`Records read: ${ plan.recordsRead }`);
    console.log(`Valid records: ${ plan.validRecords }`);
    console.log(`Invalid records: ${ plan.invalidRecords.length }`);
    console.log(`Duplicate ID groups: ${ plan.duplicateIds.length }`);

    if (safety.mode === 'EXECUTE') {
        console.log(`Records written: ${ writeResult?.writtenRecords ?? 0 }`);
    } else {
        console.log(`Records that would be written: ${ safety.writableRecords }`);
    }

    console.log(`Records skipped by --skip-invalid: ${ safety.skippedRecords }`);

    if (safety.refusalReasons.length > 0) {
        console.log('Write refusal reasons:');
        safety.refusalReasons.forEach(reason => console.log(`- ${ reason }`));
    }

    if (plan.duplicateIds.length > 0) {
        console.log('Duplicate ID details:');
        plan.duplicateIds.forEach(({ id, indexes }) => {
            console.log(`- id ${ JSON.stringify(id) } at source indexes ${ indexes.join(', ') }`);
        });
    }

    if (plan.invalidRecords.length > 0) {
        console.log('Invalid record details:');
        plan.invalidRecords.forEach(({ index, id, reasons }) => {
            const idText = id === undefined ? 'unknown id' : `id ${ JSON.stringify(id) }`;
            console.log(`- index ${ index } (${ idText }): ${ reasons.join('; ') }`);
        });
    }

    console.log(`Sample transformed WineStock input records (${ plan.sampleTransformedWines.length }):`);
    printJsonBlock(plan.sampleTransformedWines);
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

const writeWineStockRecords = async ({ tableName, retailerId, region, wines }) => {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
        marshallOptions: {
            removeUndefinedValues: true,
        },
    });
    const wineStockStore = createWineStockStore(client, tableName);

    await wineStockStore.upsertWineListings({ retailerId, wines });

    return {
        writtenRecords: wines.length,
    };
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printUsage();
        return;
    }

    validateOptions(options);

    const migrationTimestamp = new Date().toISOString();
    const sourceJson = await readS3ObjectText({
        bucket: options.bucket,
        key: options.key,
        region: options.region,
    });
    const plan = createMigrationPlan({ sourceJson, migrationTimestamp });
    const safety = evaluateWriteSafety({
        execute: options.execute,
        skipInvalid: options.skipInvalid,
        plan,
    });

    if (!options.execute) {
        printSummary({ options, plan, safety });
        console.log('No DynamoDB reads or writes performed. Add --execute to write valid records.');
        return;
    }

    if (!safety.safeToWrite) {
        printSummary({ options, plan, safety });
        throw new Error('Unsafe execute request refused before writing to DynamoDB');
    }

    const writeResult = await writeWineStockRecords({
        tableName: options.table_name,
        retailerId: options.retailer_id,
        region: options.region,
        wines: plan.transformedWines,
    });

    printSummary({ options, plan, safety, writeResult });
    console.log('WineStock records written successfully.');
};

main().catch(error => {
    console.error(`Migration failed: ${ error.message }`);
    process.exitCode = 1;
});
