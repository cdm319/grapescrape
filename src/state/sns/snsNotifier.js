import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

export const formatWine = wine => `${wine.name} ${wine.vintage} - £${wine.price}`;

export const buildMessage = ({ added, removed, current }) => {
    const lines = [];

    lines.push('GrapeScrape Update');
    lines.push('');

    if (added.length) {
        lines.push(`New Wines (${added.length}):`);
        added.forEach(wine => lines.push(`+ ${formatWine(wine)}`));
        lines.push('');
    }

    if (removed.length) {
        lines.push(`Removed Wines (${removed.length}):`);
        removed.forEach(wine => lines.push(`- ${formatWine(wine)}`));
        lines.push('');
    }

    lines.push(`Current Stock (${current.length}):`);
    current.forEach(wine => lines.push(`${formatWine(wine)}`));

    return lines.join('\n');
};

export const createSnsNotifier = ({ topicArn = process.env.SNS_TOPIC_ARN } = {}) => {
    if (!topicArn) throw new Error('Topic ARN is required');

    return {
        async notify(data) {
            const message = buildMessage(data);

            await sns.send(new PublishCommand({
                TopicArn: topicArn,
                Subject: 'GrapeScrape Update',
                Message: message
            }));
        }
    }
}