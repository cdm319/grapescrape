import OpenAI from "openai";
import { getOpenAiApiKey } from "../secretsManager.js";
import { wineAssessmentSchema } from "./wineAssessmentSchema.js";
import { wineAssessmentPrompt } from "./wineAssessmentPrompt.js";

export const createOpenAiWineAssessmentProvider = ({
                                                       model = process.env.OPENAI_MODEL,
                                                       getApiKey = getOpenAiApiKey
                                                   } = {}) => {
    let existingClient;

    const getClient = async () => {
        if (!existingClient) {
            existingClient = getApiKey().then(apiKey => new OpenAI({ apiKey }));
        }

        return existingClient;
    };

    return {
        async assessWine({ wine, palateProfile }) {
            const client = await getClient();

            console.log(`Sent wine ${ wine.id } to OpenAI for assessment.`);

            const response = await client.responses.create({
                model,
                prompt_cache_key: `grapescrape-wine-assessment-profile-v${ palateProfile.version }`,
                prompt_cache_retention: '24h',
                input: [
                    {
                        role: 'system',
                        content: wineAssessmentPrompt,
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            task: 'Use this palate profile for all following wine assessment.',
                            palateProfile,
                        }),
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            task: 'Assess this wine against the given palate profile',
                            wine,
                        }),
                    },
                ],
                text: {
                    format: {
                        type: 'json_schema',
                        name: 'wine_assessment',
                        strict: true,
                        schema: wineAssessmentSchema,
                    },
                },
            });

            console.log(`Received assessment for wine ${ wine.id } from OpenAI.`);

            return JSON.parse(response.output_text);
        },
    };
};
