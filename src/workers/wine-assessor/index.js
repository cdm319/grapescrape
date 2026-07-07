export const handler = async (event, context) => {
    try {
        const sqsEvents = event.Records;
        console.log(`GrapeScrape wine assessor starting with ${sqsEvents.length} events.`);

        console.log("GrapeScrape wine assessor finished.");

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Wine assessment completed successfully." }),
        };
    } catch (error) {
        console.error("Error in wine assessor:", error);
        throw error;
    }
};
