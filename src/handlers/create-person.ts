import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { decodeTime, ulid } from 'ulid';
import { createPersonSchema, Person, toItem } from '../person';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const response = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let payload: unknown;
  try {
    payload = JSON.parse(event.body ?? '');
  } catch {
    return response(400, { message: 'Request body must be valid JSON' });
  }

  const parsed = createPersonSchema.safeParse(payload);
  if (!parsed.success) {
    return response(400, {
      message: 'Validation failed',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const personId = ulid();
  const person: Person = {
    personId,
    createdAt: new Date(decodeTime(personId)).toISOString(),
    ...parsed.data,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: toItem(person),
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (err) {
    console.error('Failed to create person', err);
    return response(500, { message: 'Internal server error' });
  }

  return response(201, person);
};
