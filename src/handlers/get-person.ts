import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { fromItem, PersonItem, ULID_PATTERN } from '../person';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const response = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const personId = event.pathParameters?.personId;
  if (!personId || !ULID_PATTERN.test(personId)) {
    return response(400, { message: 'personId must be a valid ULID' });
  }

  try {
    // Consistent read so a person is visible immediately after it was created
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { pk: `PERSON#${personId}`, sk: 'PROFILE' },
        ConsistentRead: true,
      }),
    );
    if (!Item) {
      return response(404, { message: 'Person not found' });
    }
    return response(200, fromItem(Item as PersonItem));
  } catch (err) {
    console.error('Failed to get person', err);
    return response(500, { message: 'Internal server error' });
  }
};
