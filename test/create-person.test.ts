import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { decodeTime } from 'ulid';
import { APIGatewayProxyEvent } from 'aws-lambda';

process.env.TABLE_NAME = 'persons';
import { handler } from '../src/handlers/create-person';

const ddbMock = mockClient(DynamoDBDocumentClient);

const valid = {
  firstName: 'Jan',
  lastName: 'Boel',
  phoneNumber: '+31612345678',
  address: { street: 'Rijksstraatweglaan', houseNumber: '29', postalCode: '1221DE', city: 'Amsterdam', country: 'NL' },
};
const call = (body: unknown) => handler({ body: typeof body === 'string' ? body : JSON.stringify(body) } as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset().on(PutCommand).resolves({});
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

test('creates person and stores it as an table item', async () => {
  const res = await call(valid);
  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  expect(body.personId).toMatch(/^[0-9A-Z]{26}$/);
  expect(body.pk).toBeUndefined();
  expect(body.createdAt).toBe(new Date(decodeTime(body.personId)).toISOString());
  expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toMatchObject({
    ...valid,
    pk: `PERSON#${body.personId}`,
    sk: 'PROFILE',
    entityType: 'PERSON',
    gsi1pk: 'PERSON',
    gsi1sk: body.personId,
  });
});

test.each([
  ['invalid JSON', '{nope'],
  ['missing fields', { firstName: 'Miep' }],
  ['bad phone number', { ...valid, phoneNumber: '12' }],
  ['incomplete address', { ...valid, address: { street: 'x' } }],
])('rejects %s with 400', async (_n, body) => {
  const res = await call(body);
  expect(res.statusCode).toBe(400);
  expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
});

test('returns 500 when the database fails', async () => {
  ddbMock.on(PutCommand).rejects(new Error('krakaka'));
  expect((await call(valid)).statusCode).toBe(500);
});
