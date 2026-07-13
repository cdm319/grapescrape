import { describe, expect, it, vi } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
    buildCompletedAssessmentItem,
    CompletedAssessmentConflictError,
    createAssessmentStore,
    isCompletedAssessmentConflict,
} from '@grapescrape/state/dynamodb/assessmentStore';

const assessment = {
    fit: 'strong',
    highlight: true,
    confidence: 0.92,
    headline: 'Right in the pocket',
    summary: 'Structured, savoury, and likely to suit the profile.',
    reasons: ['classic region', 'firm structure'],
};

const completedItemInput = {
    userId: 'user-1',
    assessmentInputKey: 'assessment-key-1',
    source: { type: 'retailer', key: 'retailer:tws:wine-1' },
    wineSnapshot: {
        id: 'wine-1',
        name: 'Wine One',
        sourceHash: 'source-hash-1',
    },
    sourceHash: 'source-hash-1',
    palateProfileVersion: 1,
    assessmentVersion: 2,
    model: 'gpt-example',
    assessment,
    createdAt: '2026-01-02T03:04:05.000Z',
    completedAt: '2026-01-02T03:04:06.000Z',
};

describe('createAssessmentStore', () => {
    it('requires a DynamoDB client and table names', () => {
        expect(() => createAssessmentStore()).toThrow('DynamoDB client is required');
        expect(() => createAssessmentStore({
            client: { send: vi.fn() },
            assessmentsTableName: '',
            userDataTableName: 'UserData',
        })).toThrow('ASSESSMENTS_TABLE_NAME is required');
        expect(() => createAssessmentStore({
            client: { send: vi.fn() },
            assessmentsTableName: 'Assessments',
            userDataTableName: '',
        })).toThrow('USER_DATA_TABLE_NAME is required');
    });

    it('resolves the current palate profile at processing time via the current pointer', async () => {
        const currentPointer = {
            pk: 'USER#user-1',
            sk: 'CURRENT_PALATE_PROFILE',
            entityType: 'CurrentPalateProfilePointer',
            userId: 'user-1',
            palateProfileVersion: 3,
            palateProfileSk: 'PALATE_PROFILE#3',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        const profile = {
            pk: 'USER#user-1',
            sk: 'PALATE_PROFILE#3',
            entityType: 'PalateProfile',
            userId: 'user-1',
            palateProfileVersion: 3,
            palateProfile: { likes: ['Bordeaux'] },
        };
        const client = {
            send: vi.fn()
                .mockResolvedValueOnce({ Item: currentPointer })
                .mockResolvedValueOnce({ Item: profile }),
        };

        const result = await createAssessmentStore({
            client,
            assessmentsTableName: 'Assessments',
            userDataTableName: 'UserData',
        }).getCurrentPalateProfile('user-1');

        expect(result).toEqual({
            ...profile,
            currentPointer,
        });
        expect(client.send).toHaveBeenCalledWith(expect.any(GetCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'UserData',
            Key: {
                pk: 'USER#user-1',
                sk: 'CURRENT_PALATE_PROFILE',
            },
        });
        expect(client.send.mock.calls[1][0].input).toEqual({
            TableName: 'UserData',
            Key: {
                pk: 'USER#user-1',
                sk: 'PALATE_PROFILE#3',
            },
        });
    });

    it('returns undefined when no current palate profile pointer exists', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };

        const result = await createAssessmentStore({
            client,
            assessmentsTableName: 'Assessments',
            userDataTableName: 'UserData',
        }).getCurrentPalateProfile('user-1');

        expect(result).toBeUndefined();
        expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('gets an existing completed assessment by deterministic input key', async () => {
        const existingAssessment = {
            pk: 'USER#user-1',
            sk: 'ASSESSMENT#assessment-key-1',
        };
        const client = { send: vi.fn().mockResolvedValue({ Item: existingAssessment }) };

        const result = await createAssessmentStore({
            client,
            assessmentsTableName: 'Assessments',
            userDataTableName: 'UserData',
        }).getAssessmentByInputKey({
            userId: 'user-1',
            assessmentInputKey: 'assessment-key-1',
        });

        expect(result).toBe(existingAssessment);
        expect(client.send).toHaveBeenCalledWith(expect.any(GetCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            Key: {
                pk: 'USER#user-1',
                sk: 'ASSESSMENT#assessment-key-1',
            },
        });
    });

    it('puts completed assessments without overwriting existing rows', async () => {
        const client = { send: vi.fn().mockResolvedValue({}) };
        const item = buildCompletedAssessmentItem(completedItemInput);

        await createAssessmentStore({
            client,
            assessmentsTableName: 'Assessments',
            userDataTableName: 'UserData',
        }).putCompletedAssessment(item);

        expect(client.send).toHaveBeenCalledWith(expect.any(PutCommand));
        expect(client.send.mock.calls[0][0].input).toEqual({
            TableName: 'Assessments',
            Item: item,
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        });
    });

    it('surfaces conditional write conflicts as idempotent completed-assessment conflicts', async () => {
        const conditionalError = new Error('conditional failed');
        conditionalError.name = 'ConditionalCheckFailedException';
        const client = { send: vi.fn().mockRejectedValue(conditionalError) };

        const store = createAssessmentStore({
            client,
            assessmentsTableName: 'Assessments',
            userDataTableName: 'UserData',
        });

        try {
            await store.putCompletedAssessment(buildCompletedAssessmentItem(completedItemInput));
            throw new Error('Expected putCompletedAssessment to reject');
        } catch (error) {
            expect(error).toBeInstanceOf(CompletedAssessmentConflictError);
            expect(error).toMatchObject({
                name: 'CompletedAssessmentConflictError',
                userId: 'user-1',
                assessmentInputKey: 'assessment-key-1',
                isConditionalConflict: true,
            });
            expect(isCompletedAssessmentConflict(error)).toBe(true);
        }
    });
});

describe('buildCompletedAssessmentItem', () => {
    it('builds completed assessment rows compatible with migrated assessment rows', () => {
        expect(buildCompletedAssessmentItem(completedItemInput)).toEqual({
            pk: 'USER#user-1',
            sk: 'ASSESSMENT#assessment-key-1',
            entityType: 'Assessment',

            userId: 'user-1',
            assessmentInputKey: 'assessment-key-1',

            source: { type: 'retailer', key: 'retailer:tws:wine-1' },
            sourceKey: 'retailer:tws:wine-1',
            retailerId: 'tws',
            wineId: 'wine-1',

            wineSnapshot: {
                id: 'wine-1',
                name: 'Wine One',
                sourceHash: 'source-hash-1',
            },

            sourceHash: 'source-hash-1',
            palateProfileVersion: 1,
            assessmentVersion: 2,

            status: 'completed',
            model: 'gpt-example',
            assessment,

            fit: 'strong',
            highlight: true,
            confidence: 0.92,
            headline: 'Right in the pocket',
            summary: 'Structured, savoury, and likely to suit the profile.',

            createdAt: '2026-01-02T03:04:05.000Z',
            completedAt: '2026-01-02T03:04:06.000Z',

            gsi1pk: 'USER#user-1#ASSESSMENTS',
            gsi1sk: 'CREATED#2026-01-02T03:04:05.000Z#ASSESSMENT#assessment-key-1',

            gsi2pk: 'USER#user-1#SOURCE#retailer:tws:wine-1',
            gsi2sk: 'CREATED#2026-01-02T03:04:05.000Z#ASSESSMENT#assessment-key-1',
        });
    });

    it('defaults completedAt to createdAt and preserves nullable summary fields when the assessment omits them', () => {
        const item = buildCompletedAssessmentItem({
            ...completedItemInput,
            assessment: {
                fit: 'weak',
                highlight: false,
                confidence: 0.2,
            },
            createdAt: '2026-01-02T03:04:05.000Z',
            completedAt: undefined,
        });

        expect(item.completedAt).toBe('2026-01-02T03:04:05.000Z');
        expect(item.headline).toBeNull();
        expect(item.summary).toBeNull();
    });
});
