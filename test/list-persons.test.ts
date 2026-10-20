import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';

process.env.TABLE_NAME = 'persons';
import { handler } from '../src/handlers/list-persons';

const ddbMock = mockClient(DynamoDBDocumentClient);

const id = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const key = { pk: `PERSON#${id}`, sk: 'PROFILE', gsi1pk: 'PERSON', gsi1sk: id };
const person = {
  personId: id,
  createdAt: '2026-10-20T09:00:00.000Z',
  firstName: 'Jan',
  lastName: 'Boel',
  phoneNumber: '+31612345678',
  address: { street: 'Rijksstraatweglaan', houseNumber: '29', postalCode: '1221DE', city: 'Amsterdam', country: 'NL' },
};
const token = (k: unknown) => Buffer.from(JSON.stringify(k)).toString('base64url');
const call = (qs: Record<string, string> | null = null) =>
  handler({ queryStringParameters: qs } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

test('lists newest first with default limit, hiding table keys', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ ...key, entityType: 'PERSON', ...person }] });
  const res = await call();
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ items: [person] });
  expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
    IndexName: 'gsi1',
    ScanIndexForward: false,
    Limit: 25,
    ExclusiveStartKey: undefined,
  });
});

test('returns a nextToken that can be passed back to continue', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: key });
  const first = JSON.parse((await call({ limit: '1' })).body);
  expect(JSON.parse(Buffer.from(first.nextToken, 'base64url').toString())).toEqual(key);

  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const second = await call({ nextToken: first.nextToken, limit: '1' });
  expect(second.statusCode).toBe(200);
  expect(JSON.parse(second.body).nextToken).toBeUndefined();
  expect(ddbMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(key);
});

test.each([['0'], ['101'], ['abc'], ['1.5']])('rejects limit %s with 400', async (limit) => {
  expect((await call({ limit })).statusCode).toBe(400);
  expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
});

test.each([
  ['garbage', '!!!'],
  ['wrong shape', token({ pk: 'x' })],
  ['foreign partition', token({ ...key, gsi1pk: 'OTHER' })],
  ['mismatched ids', token({ ...key, pk: 'PERSON#01JBBBBBBBBBBBBBBBBBBBBBBB' })],
])('rejects %s nextToken with 400', async (_n, nextToken) => {
  expect((await call({ nextToken })).statusCode).toBe(400);
  expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
});

test('returns 500 when the database fails', async () => {
  ddbMock.on(QueryCommand).rejects(new Error('boom'));
  expect((await call()).statusCode).toBe(500);
});
