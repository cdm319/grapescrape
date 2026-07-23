import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wineAssessmentPrompt } from '@grapescrape/domain/assessment/wineAssessmentPrompt';
import { wineAssessmentSchema } from '@grapescrape/domain/assessment/wineAssessmentSchema';
import { createOpenAiWineAssessmentProvider } from '@grapescrape/wine-assessor/openai/openAiWineAssessmentProvider.js';

const assessment = {
    fit: 'strong',
    confidence: 'high',
    highlight: true,
    headline: 'A plush, ripe match',
    summary: 'Likely to suit the profile.',
    reasoningMode: 'metadata_plus_description_plus_general_knowledge',
    reasons: ['Ripe fruit and plush texture align well.'],
    cautions: [],
    evidence: [
        {
            type: 'direct',
            source: 'wine.description',
            text: 'Retailer describes ripe fruit and supple tannins.'
        }
    ],
    assumptions: [],
    palateAlignment: {
        fruit: 'positive',
        texture: 'positive',
        oakAndDevelopment: 'neutral',
        structure: 'positive',
        overall: 'strong'
    },
    styleProfile: {
        body: 'medium_plus',
        fruitRipeness: 'ripe',
        fruitCharacter: ['black_fruit'],
        texture: ['plush'],
        oakInfluence: 'moderate',
        tannin: 'moderate',
        acidity: 'balanced',
        development: 'ready_to_drink',
        styleTags: ['fruit_forward', 'polished']
    }
};

const wine = {
    id: 'wine-1',
    name: 'Test Wine',
    vintage: 2020,
    region: 'Bordeaux',
    grape: 'Merlot',
    alcohol: '13.5%',
    description: 'Ripe and supple'
};

const palateProfileAssessmentContext = {
    palateProfileVersion: 7,
    palateProfile: {
        stylePreferences: {
            body: { preferred: ['full'], avoided: ['light'] },
            fruitRipeness: { preferred: ['ripe'], avoided: ['underripe'] },
            fruitCharacter: { preferred: ['black_fruit'], avoided: [] },
            texture: { preferred: ['plush'], avoided: ['thin'] },
            oakInfluence: { preferred: ['moderate'], avoided: ['none_detected'] },
            tannin: { preferred: ['moderate_plus'], avoided: ['firm_or_drying'] },
            acidity: { preferred: ['balanced'], avoided: ['sharp'] },
            development: { preferred: ['ready_to_drink'], avoided: [] },
            styleTags: { preferred: ['polished'], avoided: ['rustic'] }
        },
        wineExamples: [{
            name: 'Example Estate',
            vintage: '2019',
            sentiment: 'enjoyed',
            notes: 'Ripe fruit and a plush texture.'
        }]
    }
};

describe('createOpenAiWineAssessmentProvider', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('uses strict structured output with the ordered prompt, complete palate context and wine snapshot', async () => {
        vi.stubEnv('OPENAI_MODEL', 'gpt-test');
        vi.stubEnv('OPENAI_REASONING_EFFORT', 'medium');
        vi.stubEnv('OPENAI_TEXT_VERBOSITY', 'medium');
        const responsesCreate = vi.fn().mockResolvedValue({ output_text: JSON.stringify(assessment) });
        const OpenAIClient = vi.fn().mockImplementation(function () {
            return {
                responses: {
                    create: responsesCreate
                }
            };
        });
        const getApiKey = vi.fn().mockResolvedValue('test-api-key');

        const provider = createOpenAiWineAssessmentProvider({ getApiKey, OpenAIClient });

        const result = await provider.assessWine({
            wine,
            palateProfile: palateProfileAssessmentContext
        });

        expect(result).toEqual(assessment);
        expect(getApiKey).toHaveBeenCalledTimes(1);
        expect(OpenAIClient).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
        expect(responsesCreate).toHaveBeenCalledWith({
            model: 'gpt-test',
            reasoning: {
                effort: 'medium'
            },
            prompt_cache_key: 'grapescrape-wine-assessment-profile-v7',
            prompt_cache_retention: '24h',
            input: [
                {
                    role: 'system',
                    content: wineAssessmentPrompt
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        task: 'Use this palate profile for all following wine assessment.',
                        palateProfile: palateProfileAssessmentContext
                    })
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        task: 'Assess this wine against the given palate profile',
                        wine
                    })
                }
            ],
            text: {
                verbosity: 'medium',
                format: {
                    type: 'json_schema',
                    name: 'wine_assessment',
                    strict: true,
                    schema: wineAssessmentSchema
                }
            }
        });
    });

    it('can configure reasoning effort and text verbosity for the Responses API request', async () => {
        vi.stubEnv('OPENAI_MODEL', 'gpt-test');
        const responsesCreate = vi.fn().mockResolvedValue({ output_text: JSON.stringify(assessment) });
        const OpenAIClient = vi.fn().mockImplementation(function () {
            return {
                responses: {
                    create: responsesCreate
                }
            };
        });

        const provider = createOpenAiWineAssessmentProvider({
            reasoningEffort: 'low',
            textVerbosity: 'high',
            getApiKey: vi.fn().mockResolvedValue('test-api-key'),
            OpenAIClient
        });

        await provider.assessWine({
            wine,
            palateProfile: { version: 1 }
        });

        expect(responsesCreate.mock.calls[0][0]).toMatchObject({
            reasoning: {
                effort: 'low'
            },
            text: {
                verbosity: 'high',
                format: {
                    type: 'json_schema',
                    name: 'wine_assessment',
                    strict: true,
                    schema: wineAssessmentSchema
                }
            }
        });
    });

    it('caches OpenAI client construction across assessments', async () => {
        vi.stubEnv('OPENAI_MODEL', 'gpt-test');
        const responsesCreate = vi.fn().mockResolvedValue({ output_text: JSON.stringify(assessment) });
        const OpenAIClient = vi.fn().mockImplementation(function () {
            return {
                responses: {
                    create: responsesCreate
                }
            };
        });
        const getApiKey = vi.fn().mockResolvedValue('test-api-key');

        const provider = createOpenAiWineAssessmentProvider({ getApiKey, OpenAIClient });

        await provider.assessWine({ wine, palateProfile: { version: 1 } });
        await provider.assessWine({ wine: { ...wine, id: 'wine-2' }, palateProfile: { version: 1 } });

        expect(getApiKey).toHaveBeenCalledTimes(1);
        expect(OpenAIClient).toHaveBeenCalledTimes(1);
        expect(responsesCreate).toHaveBeenCalledTimes(2);
    });

    it('retries OpenAI client construction after a transient API key failure', async () => {
        vi.stubEnv('OPENAI_MODEL', 'gpt-test');
        const responsesCreate = vi.fn().mockResolvedValue({ output_text: JSON.stringify(assessment) });
        const OpenAIClient = vi.fn().mockImplementation(function () {
            return {
                responses: {
                    create: responsesCreate
                }
            };
        });
        const getApiKey = vi.fn()
            .mockRejectedValueOnce(new Error('Secrets Manager unavailable'))
            .mockResolvedValueOnce('test-api-key');

        const provider = createOpenAiWineAssessmentProvider({ getApiKey, OpenAIClient });

        await expect(provider.assessWine({ wine, palateProfile: { version: 1 } }))
            .rejects.toThrow('Secrets Manager unavailable');
        await expect(provider.assessWine({ wine, palateProfile: { version: 1 } }))
            .resolves.toEqual(assessment);

        expect(getApiKey).toHaveBeenCalledTimes(2);
        expect(OpenAIClient).toHaveBeenCalledTimes(1);
        expect(responsesCreate).toHaveBeenCalledTimes(1);
    });

    it('can build the prompt cache key from palateProfileVersion', async () => {
        vi.stubEnv('OPENAI_MODEL', 'gpt-test');
        const responsesCreate = vi.fn().mockResolvedValue({ output_text: JSON.stringify(assessment) });
        const OpenAIClient = vi.fn().mockImplementation(function () {
            return {
                responses: {
                    create: responsesCreate
                }
            };
        });

        const provider = createOpenAiWineAssessmentProvider({
            getApiKey: vi.fn().mockResolvedValue('test-api-key'),
            OpenAIClient
        });

        await provider.assessWine({
            wine,
            palateProfile: {
                palateProfileVersion: 3,
                summary: 'Likes ripe plush reds'
            }
        });

        expect(responsesCreate.mock.calls[0][0].prompt_cache_key).toBe('grapescrape-wine-assessment-profile-v3');
    });

    it('requires OPENAI_MODEL before creating a provider', () => {
        vi.stubEnv('OPENAI_MODEL', '');

        expect(() => createOpenAiWineAssessmentProvider({
            getApiKey: vi.fn(),
            OpenAIClient: vi.fn()
        })).toThrow('OPENAI_MODEL is required');
    });
});
