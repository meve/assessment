import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { fromItem, PersonItem } from '../person';

interface StreamRecord {
  dynamodb: { NewImage: Record<string, AttributeValue> };
}

export const handler = async (records: StreamRecord[]) =>
  records.map((record) => {
    return { version: 1, person: fromItem(unmarshall(record.dynamodb.NewImage) as PersonItem) };
  });
