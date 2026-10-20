import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { fromItem, GSI1, PERSON_GSI1PK, PersonItem, ULID_PATTERN } from '../person';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const response = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const encodeToken = (key: Record<string, unknown>) => Buffer.from(JSON.stringify(key)).toString('base64url');

const decodeToken = (token: string): Record<string, string> | undefined => {
  try {
    const key = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    const id = typeof key?.gsi1sk === 'string' ? key.gsi1sk : '';
    if (
      Object.keys(key).sort().join() === 'gsi1pk,gsi1sk,pk,sk' &&
      key.gsi1pk === PERSON_GSI1PK &&
      ULID_PATTERN.test(id) &&
      key.pk === `PERSON#${id}` &&
      key.sk === 'PROFILE'
    ) {
      return key;
    }
  } catch {
    // fall through
  }
  return undefined;
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { limit: rawLimit, nextToken } = event.queryStringParameters ?? {};

  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return response(400, { message: `limit must be an integer between 1 and ${MAX_LIMIT}` });
  }

  let exclusiveStartKey: Record<string, string> | undefined;
  if (nextToken !== undefined) {
    exclusiveStartKey = decodeToken(nextToken);
    if (!exclusiveStartKey) {
      return response(400, { message: 'nextToken is invalid' });
    }
  }

  try {
    const { Items = [], LastEvaluatedKey } = await ddb.send(
      new QueryCommand({
        TableName: process.env.TABLE_NAME,
        IndexName: GSI1,
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': PERSON_GSI1PK },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    return response(200, {
      items: Items.map((item) => fromItem(item as PersonItem)),
      ...(LastEvaluatedKey && { nextToken: encodeToken(LastEvaluatedKey) }),
    });
  } catch (err) {
    console.error('Failed to list persons', err);
    return response(500, { message: 'Internal server error' });
  }
};
