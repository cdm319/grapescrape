const STYLE_PREFERENCE_VALUES = {
    body: [
        'light',
        'medium_minus',
        'medium',
        'medium_plus',
        'full',
    ],
    fruitRipeness: [
        'underripe',
        'fresh',
        'ripe',
        'very_ripe',
        'jammy',
    ],
    fruitCharacter: [
        'red_fruit',
        'black_fruit',
        'dark_fruit',
        'blackcurrant',
        'blackberry',
        'plum',
        'black_cherry',
        'red_cherry',
        'dried_fruit',
        'cranberry',
    ],
    texture: [
        'supple',
        'silky',
        'velvety',
        'plush',
        'fleshy',
        'generous',
        'polished',
        'firm',
        'lean',
        'austere',
        'thin',
    ],
    oakInfluence: [
        'none_detected',
        'subtle',
        'moderate',
        'pronounced',
    ],
    tannin: [
        'low',
        'moderate',
        'moderate_plus',
        'high',
        'firm_or_drying',
    ],
    acidity: [
        'low',
        'balanced',
        'fresh',
        'high',
        'sharp',
    ],
    development: [
        'youthful',
        'ready_to_drink',
        'developing',
        'mature',
    ],
    styleTags: [
        'fruit_forward',
        'classic',
        'modern',
        'traditional',
        'opulent',
        'approachable',
        'structured',
        'rustic',
        'elegant',
        'spicy',
        'earthy',
        'savoury',
        'unoaked',
        'oak_influenced',
        'chillable',
        'food_wine',
        'polished',
    ],
};

const PROFILE_FIELDS = ['stylePreferences', 'wineExamples'];
const PREFERENCE_FIELDS = Object.keys(STYLE_PREFERENCE_VALUES);
const PREFERENCE_GROUP_FIELDS = ['preferred', 'avoided'];
const WINE_EXAMPLE_FIELDS = ['id', 'name', 'vintage', 'sentiment', 'notes'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VINTAGE_PATTERN = /^(?:[12]\d{3}|NV)$/;

export const validatePalateProfile = profile => {
    const errors = [];

    if (!validateObjectShape({
        value: profile,
        path: 'profile',
        fields: PROFILE_FIELDS,
        errors,
    })) {
        return validationResult(errors);
    }

    validateStylePreferences(profile.stylePreferences, errors);
    validateWineExamples(profile.wineExamples, errors);

    return validationResult(errors);
};

const validateStylePreferences = (stylePreferences, errors) => {
    if (!validateObjectShape({
        value: stylePreferences,
        path: 'profile.stylePreferences',
        fields: PREFERENCE_FIELDS,
        errors,
    })) {
        return;
    }

    for (const dimension of PREFERENCE_FIELDS) {
        const preference = stylePreferences[dimension];
        const path = `profile.stylePreferences.${ dimension }`;

        if (!validateObjectShape({
            value: preference,
            path,
            fields: PREFERENCE_GROUP_FIELDS,
            errors,
        })) {
            continue;
        }

        const allowedValues = new Set(STYLE_PREFERENCE_VALUES[dimension]);
        const preferredValues = validatePreferenceValues({
            value: preference.preferred,
            path: `${ path }.preferred`,
            allowedValues,
            errors,
        });
        const avoidedValues = validatePreferenceValues({
            value: preference.avoided,
            path: `${ path }.avoided`,
            allowedValues,
            errors,
        });

        if (
            preferredValues
            && avoidedValues
            && preferredValues.some(value => avoidedValues.includes(value))
        ) {
            errors.push({
                field: path,
                reason: 'preferred and avoided values must not overlap',
            });
        }
    }
};

const validatePreferenceValues = ({
    value,
    path,
    allowedValues,
    errors,
}) => {
    if (!Array.isArray(value)) {
        errors.push({
            field: path,
            reason: 'must be an array',
        });
        return undefined;
    }

    const seen = new Set();
    let hasDuplicate = false;

    value.forEach((item, index) => {
        if (typeof item !== 'string' || !allowedValues.has(item)) {
            errors.push({
                field: `${ path }[${ index }]`,
                reason: 'must be an allowed style value',
            });
            return;
        }

        if (seen.has(item)) {
            hasDuplicate = true;
        }

        seen.add(item);
    });

    if (hasDuplicate) {
        errors.push({
            field: path,
            reason: 'must not contain duplicate values',
        });
    }

    return value;
};

const validateWineExamples = (wineExamples, errors) => {
    if (!Array.isArray(wineExamples)) {
        errors.push({
            field: 'profile.wineExamples',
            reason: 'must be an array',
        });
        return;
    }

    const ids = new Set();
    const identities = new Set();
    let enjoyedCount = 0;
    let notEnjoyedCount = 0;

    wineExamples.forEach((example, index) => {
        const path = `profile.wineExamples[${ index }]`;

        if (!validateObjectShape({
            value: example,
            path,
            fields: WINE_EXAMPLE_FIELDS,
            errors,
        })) {
            return;
        }

        validateWineExampleFields({ example, path, errors });

        if (typeof example.id === 'string' && UUID_PATTERN.test(example.id)) {
            const normalisedId = example.id.toLowerCase();

            if (ids.has(normalisedId)) {
                errors.push({
                    field: `${ path }.id`,
                    reason: 'must be unique within the profile',
                });
            }

            ids.add(normalisedId);
        }

        if (
            typeof example.name === 'string'
            && typeof example.vintage === 'string'
            && VINTAGE_PATTERN.test(example.vintage)
        ) {
            const identity = `${ normaliseIdentityName(example.name) }\u0000${ example.vintage }`;

            if (identities.has(identity)) {
                errors.push({
                    field: path,
                    reason: 'name and vintage must be unique within the profile',
                });
            }

            identities.add(identity);
        }

        if (example.sentiment === 'enjoyed') {
            enjoyedCount += 1;
        } else if (example.sentiment === 'not_enjoyed') {
            notEnjoyedCount += 1;
        }
    });

    if (enjoyedCount > 20) {
        errors.push({
            field: 'profile.wineExamples',
            reason: 'must contain no more than 20 enjoyed examples',
        });
    }

    if (notEnjoyedCount > 20) {
        errors.push({
            field: 'profile.wineExamples',
            reason: 'must contain no more than 20 not_enjoyed examples',
        });
    }
};

const validateWineExampleFields = ({ example, path, errors }) => {
    if (typeof example.id !== 'string' || !UUID_PATTERN.test(example.id)) {
        errors.push({
            field: `${ path }.id`,
            reason: 'must be a UUID',
        });
    }

    if (
        typeof example.name !== 'string'
        || example.name.trim() !== example.name
        || characterLength(example.name) < 1
        || characterLength(example.name) > 120
    ) {
        errors.push({
            field: `${ path }.name`,
            reason: 'must be a trimmed string between 1 and 120 characters',
        });
    }

    if (typeof example.vintage !== 'string' || !VINTAGE_PATTERN.test(example.vintage)) {
        errors.push({
            field: `${ path }.vintage`,
            reason: 'must be a year from 1000 through 2999 or NV',
        });
    }

    if (!['enjoyed', 'not_enjoyed'].includes(example.sentiment)) {
        errors.push({
            field: `${ path }.sentiment`,
            reason: 'must be enjoyed or not_enjoyed',
        });
    }

    if (typeof example.notes !== 'string' || characterLength(example.notes) > 400) {
        errors.push({
            field: `${ path }.notes`,
            reason: 'must be a string no longer than 400 characters',
        });
    }
};

const validateObjectShape = ({
    value,
    path,
    fields,
    errors,
}) => {
    if (!isPlainObject(value)) {
        errors.push({
            field: path,
            reason: 'must be an object',
        });
        return false;
    }

    for (const field of fields) {
        if (!Object.hasOwn(value, field)) {
            errors.push({
                field: `${ path }.${ field }`,
                reason: 'is required',
            });
        }
    }

    for (const field of Object.keys(value)) {
        if (!fields.includes(field)) {
            errors.push({
                field: `${ path }.${ field }`,
                reason: 'is not allowed',
            });
        }
    }

    return true;
};

const validationResult = errors => ({
    valid: errors.length === 0,
    errors,
});

const normaliseIdentityName = name => name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();

const characterLength = value => Array.from(value).length;

const isPlainObject = value =>
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
