import OpenAI from 'openai';
import { wineAssessmentPrompt } from '@grapescrape/domain/assessment/wineAssessmentPrompt';
import { wineAssessmentSchema } from '@grapescrape/domain/assessment/wineAssessmentSchema';
import { getOpenAiApiKey } from '../secretsManager.js';

export const createOpenAiWineAssessmentProvider = ({
    model = process.env.OPENAI_MODEL,
    getApiKey = getOpenAiApiKey,
    OpenAIClient = OpenAI
} = {}) => {
    if (!model) throw new Error('OPENAI_MODEL is required');

    let existingClient;

    const getClient = async () => {
        if (!existingClient) {
            existingClient = (async () => {
                try {
                    const apiKey = await getApiKey();

                    return new OpenAIClient({ apiKey });
                } catch (error) {
                    existingClient = undefined;
                    throw error;
                }
            })();
        }

        return existingClient;
    };

    return {
        async assessWine({ wine, palateProfile }) {
            if (!wine) throw new Error('Wine is required');
            if (!palateProfile) throw new Error('Palate profile is required');

            const palateProfileVersion = palateProfile.version ?? palateProfile.palateProfileVersion;

            if (!palateProfileVersion) throw new Error('Palate profile version is required');

            const client = await getClient();

            console.log(`Sent wine ${ wine.id } to OpenAI for assessment.`);

            const response = await client.responses.create({
                model,
                prompt_cache_key: `grapescrape-wine-assessment-profile-v${ palateProfileVersion }`,
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
                            palateProfile
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
                    format: {
                        type: 'json_schema',
                        name: 'wine_assessment',
                        strict: true,
                        schema: wineAssessmentSchema
                    }
                }
            });

            console.log(`Received assessment for wine ${ wine.id } from OpenAI.`);

            return JSON.parse(response.output_text);
        }
    };
};
