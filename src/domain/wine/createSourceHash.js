import { createHash } from 'node:crypto';

const SOURCE_HASH_FIELDS = [
    'name',
    'vintage',
    'region',
    'alcohol'
];

/**
 * Creates a stable hash of the wine fields that affect assessment output.
 *
 * Be deliberately conservative when changing this field list. Adding or removing
 * fields will make existing assessments look stale and can trigger unnecessary
 * reassessment/OpenAI spend.
 *
 * Deliberately excluded for now:
 * - price: does not change the flavour assessment
 * - grape: too vulnerable to change
 * - description: too vulnerable to change
 *
 * @param wine
 * @returns string - the hash of the wine data
 */
export const createSourceHash = wine => {
    const source = Object.fromEntries(
        SOURCE_HASH_FIELDS.map(field => [field, normaliseHashValue(wine?.[field])])
    );

    return createHash('sha256')
        .update(JSON.stringify(source))
        .digest('hex');
};

const normaliseHashValue = value => value ?? null;
