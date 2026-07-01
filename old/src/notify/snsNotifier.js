import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

export const formatWine = wine => `${ wine.name } ${ wine.vintage } - £${ wine.price }`;

const formatHighlightedMatch = ({ wine, assessment }) => {
    const lines = [];

    lines.push(`+ ${ formatWine(wine) }`);
    lines.push(`  ${ assessment.fit } match, ${ assessment.confidence } confidence`);

    if (assessment.summary) lines.push(`  ${ assessment.summary }`);
    if (assessment.reasons?.length) lines.push(`  Why: ${ assessment.reasons.slice(0, 2).join('; ') }`);
    if (assessment.cautions?.length) lines.push(`  Caution: ${ assessment.cautions.slice(0, 1).join('; ') }`);

    return lines.join('\n');
};

export const buildMessage = ({ added, removed, current, highlightedMatches = [] }) => {
    const lines = [];

    lines.push('GrapeScrape Update');
    lines.push('')

    if (highlightedMatches.length) {
        lines.push(`High Confidence Matches (${ highlightedMatches.length }):`);
        highlightedMatches.forEach(match => lines.push(formatHighlightedMatch(match)));
        lines.push('');
    }

    if (added.length) {
        lines.push(`New Wines (${ added.length }):`);
        added.forEach(wine => lines.push(`+ ${ formatWine(wine) }`));
        lines.push('');
    }

    if (removed.length) {
        lines.push(`Removed Wines (${ removed.length }):`);
        removed.forEach(wine => lines.push(`- ${ formatWine(wine) }`));
        lines.push('');
    }

    lines.push(`Current Stock (${ current.length }):`);
    current.forEach(wine => lines.push(`${ formatWine(wine) }`));

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