export const wineAssessmentSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        fit: {
            type: 'string',
            enum: ['strong', 'good', 'maybe', 'poor']
        },
        confidence: {
            type: 'string',
            enum: ['high', 'medium_high', 'medium', 'low']
        },
        highlight: {
            type: 'boolean'
        },
        headline: {
            type: 'string'
        },
        summary: {
            type: 'string'
        },
        reasoningMode: {
            type: 'string',
            enum: [
                'description_only',
                'metadata_plus_description',
                'metadata_plus_description_plus_general_knowledge',
                'insufficient_evidence'
            ]
        },
        reasons: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: { type: 'string' }
        },
        cautions: {
            type: 'array',
            minItems: 0,
            maxItems: 5,
            items: { type: 'string' }
        },
        evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    type: {
                        type: 'string',
                        enum: ['direct', 'inferred']
                    },
                    source: {
                        type: 'string',
                        enum: [
                            'wine.name',
                            'wine.region',
                            'wine.vintage',
                            'wine.grape',
                            'wine.alcohol',
                            'wine.description',
                            'general_wine_knowledge'
                        ]
                    },
                    text: {
                        type: 'string'
                    }
                },
                required: ['type', 'source', 'text']
            }
        },
        assumptions: {
            type: 'array',
            minItems: 0,
            maxItems: 5,
            items: { type: 'string' }
        },
        palateAlignment: {
            type: 'object',
            additionalProperties: false,
            properties: {
                fruit: {
                    type: 'string',
                    enum: ['positive', 'mixed', 'neutral', 'caution', 'unknown']
                },
                texture: {
                    type: 'string',
                    enum: ['positive', 'mixed', 'neutral', 'caution', 'unknown']
                },
                oakAndDevelopment: {
                    type: 'string',
                    enum: ['positive', 'mixed', 'neutral', 'caution', 'unknown']
                },
                structure: {
                    type: 'string',
                    enum: ['positive', 'mixed', 'neutral', 'caution', 'unknown']
                },
                overall: {
                    type: 'string',
                    enum: ['strong', 'good', 'maybe', 'poor']
                }
            },
            required: ['fruit', 'texture', 'oakAndDevelopment', 'structure', 'overall']
        },
        styleProfile: {
            type: 'object',
            additionalProperties: false,
            properties: {
                body: {
                    type: 'string',
                    enum: ['light', 'medium_minus', 'medium', 'medium_plus', 'full', 'unknown']
                },
                fruitRipeness: {
                    type: 'string',
                    enum: ['underripe', 'fresh', 'ripe', 'very_ripe', 'jammy', 'unknown']
                },
                fruitCharacter: {
                    type: 'array',
                    minItems: 0,
                    maxItems: 10,
                    items: {
                        type: 'string',
                        enum: [
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
                            'unknown'
                        ]
                    }
                },
                texture: {
                    type: 'array',
                    minItems: 0,
                    maxItems: 8,
                    items: {
                        type: 'string',
                        enum: [
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
                            'unknown'
                        ]
                    }
                },
                oakInfluence: {
                    type: 'string',
                    enum: ['none_detected', 'subtle', 'moderate', 'pronounced', 'unknown']
                },
                tannin: {
                    type: 'string',
                    enum: ['low', 'moderate', 'moderate_plus', 'high', 'firm_or_drying', 'unknown']
                },
                acidity: {
                    type: 'string',
                    enum: ['low', 'balanced', 'fresh', 'high', 'sharp', 'unknown']
                },
                development: {
                    type: 'string',
                    enum: ['youthful', 'ready_to_drink', 'developing', 'mature', 'unknown']
                },
                styleTags: {
                    type: 'array',
                    minItems: 0,
                    maxItems: 10,
                    items: {
                        type: 'string',
                        enum: [
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
                            'polished'
                        ]
                    }
                }
            },
            required: [
                'body',
                'fruitRipeness',
                'fruitCharacter',
                'texture',
                'oakInfluence',
                'tannin',
                'acidity',
                'development',
                'styleTags'
            ]
        }
    },
    required: [
        'fit',
        'confidence',
        'highlight',
        'headline',
        'summary',
        'reasoningMode',
        'reasons',
        'cautions',
        'evidence',
        'assumptions',
        'palateAlignment',
        'styleProfile'
    ]
};
