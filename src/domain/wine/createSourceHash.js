import { createHash } from 'node:crypto';

const SOURCE_HASH_FIELDS = [
    'name',
    'vintage',
    'region',
    'alcohol',
    'description'
];

/**
 * Creates a stable hash of the wine fields that affect assessment output.
 *
 * Be deliberately conservative when changing this field list. Adding or removing
 * fields will make existing assessments look stale and can trigger unnecessary
 * reassessment/OpenAI spend.
 *
 * Deliberately excluded for now:
 * - price: useful for display, but should not change the flavour assessment
 * - grape: not included in the original assessment cache hash
 *
 * @param wine
 * @returns string
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
