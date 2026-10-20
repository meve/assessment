import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';

process.env.TABLE_NAME = 'persons';
import { handler } from '../src/handlers/get-person';

const ddbMock = mockClient(DynamoDBDocumentClient);

const id = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const person = {
  personId: id,
  createdAt: '2026-10-20T09:00:00.000Z',
  firstName: 'Jan',
  lastName: 'Boel',
  phoneNumber: '+31612345678',
  address: { street: 'Rijksstraatweglaan', houseNumber: '29', postalCode: '1221DE', city: 'Amsterdam', country: 'NL' },
};
const call = (personId?: string) => handler({ pathParameters: personId ? { personId } : null } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

test('returns the person without table keys', async () => {
  ddbMock.on(GetCommand).resolves({ Item: { pk: `PERSON#${id}`, sk: 'PROFILE', entityType: 'PERSON', ...person } });
  const res = await call(id);
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual(person);
  expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toMatchObject({
    Key: { pk: `PERSON#${id}`, sk: 'PROFILE' },
    ConsistentRead: true,
  });
});

test('returns 404 when the person does not exist', async () => {
  ddbMock.on(GetCommand).resolves({});
  expect((await call(id)).statusCode).toBe(404);
});

test.each([['not-a-ulid'], ['01jaaaaaaaaaaaaaaaaaaaaaaa'], [undefined]])('rejects invalid id %s with 400', async (bad) => {
  expect((await call(bad)).statusCode).toBe(400);
  expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
});

test('returns 500 when the database fails', async () => {
  ddbMock.on(GetCommand).rejects(new Error('boom'));
  expect((await call(id)).statusCode).toBe(500);
});
