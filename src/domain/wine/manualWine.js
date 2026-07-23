import { createHash } from 'node:crypto';

const CREATE_FIELDS = ['name', 'vintage', 'description'];
const PATCH_FIELDS = ['description'];
const VINTAGE_PATTERN = /^(?:[12]\d{3}|NV)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateManualWineCreateInput = input =>
    validateManualWineInput({
        input,
        fields: CREATE_FIELDS,
        validateFields: validateCreateFields,
    });

export const validateManualWinePatchInput = input =>
    validateManualWineInput({
        input,
        fields: PATCH_FIELDS,
        validateFields: validatePatchFields,
    });

export const normaliseManualWineName = name => name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();

export const createManualWineIdentity = ({ name, vintage }) =>
    `${ normaliseManualWineName(name) }\u0000${ vintage }`;

export const createManualWineSourceHash = ({
    name,
    vintage,
    description,
}) => createHash('sha256')
    .update(JSON.stringify({
        name,
        vintage,
        description,
    }))
    .digest('hex');

export const isManualWineId = value =>
    typeof value === 'string'
    && UUID_PATTERN.test(value);

const validateManualWineInput = ({
    input,
    fields,
    validateFields,
}) => {
    const errors = [];
    let hasUnknownFields = false;

    if (!isObject(input)) {
        return {
            valid: false,
            hasUnknownFields: false,
            errors: [{
                field: 'body',
                reason: 'must be a JSON object',
            }],
        };
    }

    for (const field of fields) {
        if (!Object.hasOwn(input, field)) {
            errors.push({
                field,
                reason: 'is required',
            });
        }
    }

    for (const field of Object.keys(input)) {
        if (!fields.includes(field)) {
            hasUnknownFields = true;
            errors.push({
                field,
                reason: 'is not allowed',
            });
        }
    }

    validateFields(input, errors);

    return {
        valid: errors.length === 0,
        hasUnknownFields,
        errors,
    };
};

const validateCreateFields = (input, errors) => {
    if (
        Object.hasOwn(input, 'name')
        && (
            typeof input.name !== 'string'
            || input.name.trim() !== input.name
            || characterLength(input.name) < 1
            || characterLength(input.name) > 120
        )
    ) {
        errors.push({
            field: 'name',
            reason: 'must be a trimmed string between 1 and 120 characters',
        });
    }

    if (
        Object.hasOwn(input, 'vintage')
        && (
            typeof input.vintage !== 'string'
            || !VINTAGE_PATTERN.test(input.vintage)
        )
    ) {
        errors.push({
            field: 'vintage',
            reason: 'must be a year from 1000 through 2999 or NV',
        });
    }

    validateDescription(input, errors);
};

const validatePatchFields = (input, errors) => {
    validateDescription(input, errors);
};

const validateDescription = (input, errors) => {
    if (
        Object.hasOwn(input, 'description')
        && (
            typeof input.description !== 'string'
            || characterLength(input.description) > 2_000
        )
    ) {
        errors.push({
            field: 'description',
            reason: 'must be a string no longer than 2000 characters',
        });
    }
};

const characterLength = value => Array.from(value).length;

const isObject = value =>
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
