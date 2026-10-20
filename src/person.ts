import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const createPersonSchema = z.object({
  firstName: trimmed(100),
  lastName: trimmed(100),
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'must be in E.164 format, e.g. +31612345678'),
  address: z.object({
    street: trimmed(200),
    houseNumber: trimmed(20),
    postalCode: trimmed(20),
    city: trimmed(100),
    country: trimmed(100),
  }),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;

export interface Person extends CreatePersonInput {
  personId: string;
  createdAt: string;
}

export interface PersonItem extends Person {
  pk: string;
  sk: string;
  entityType: 'PERSON';
  gsi1pk: string;
  gsi1sk: string;
}

export const GSI1 = 'gsi1';
export const PERSON_GSI1PK = 'PERSON';

export const toItem = (person: Person): PersonItem => ({
  pk: `PERSON#${person.personId}`,
  sk: 'PROFILE',
  entityType: 'PERSON',
  gsi1pk: PERSON_GSI1PK,
  gsi1sk: person.personId,
  ...person,
});

export const ULID_PATTERN = /^[0-9A-Z]{26}$/;

export const fromItem = ({ pk, sk, entityType, gsi1pk, gsi1sk, ...person }: PersonItem): Person => person;
