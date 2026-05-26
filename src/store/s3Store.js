import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

export const createS3Store = ({ bucket = process.env.STORE_BUCKET, key = process.env.STORE_KEY }) => {
    if (!bucket || !key) throw new Error('Bucket and key are required');

    return {
        async load() {
            try {
                const response = await s3.send(
                    new GetObjectCommand({
                        Bucket: bucket,
                        Key: key
                    })
                );

                const body = await response.Body.transformToString();
                return JSON.parse(body);
            } catch (error) {
                if (error.name === 'NoSuchKey') return []; // file does not exist, return empty array
                throw error;
            }
        },

        async save(data) {
            await s3.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: JSON.stringify(data, null, 2),
                    ContentType: 'application/json'
                })
            );
        }
    }
};