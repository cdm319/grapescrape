import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});

let cachedOpenAiApiKey;

/**
 * Retrieves the OpenAI API key from AWS Secrets Manager.
 *
 * @param config
 * @param config.secretName
 * @returns string - the OpenAI API key
 */
export const getOpenAiApiKey = async ({ secretName = process.env.OPENAI_API_KEY_NAME } = {}) => {
    if (cachedOpenAiApiKey) return cachedOpenAiApiKey;

    if (!secretName) throw new Error('OPENAI_API_KEY_NAME is required');

    const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));

    if (!response.SecretString) throw new Error('No SecretString found for OPENAI_API_KEY_NAME');

    cachedOpenAiApiKey = response.SecretString;

    return cachedOpenAiApiKey;
}
