import { handler } from '../src/handlers/person-created-enricher';

test('maps stream records to PersonCreated detail without keys', async () => {
  const out = await handler([
    {
      dynamodb: {
        NewImage: {
          pk: { S: 'PERSON#1' },
          sk: { S: 'PROFILE' },
          entityType: { S: 'PERSON' },
          gsi1pk: { S: 'PERSON' },
          gsi1sk: { S: '1' },
          personId: { S: '1' },
          firstName: { S: 'Miep' },
          address: { M: { city: { S: 'Amsterdam' } } },
        },
      },
    },
  ]);
  expect(out).toEqual([{ version: 1, person: { personId: '1', firstName: 'Miep', address: { city: 'Amsterdam' } } }]);
});
