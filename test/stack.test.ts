import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PersonServiceStack } from '../lib/person-service-stack';

const synth = (stage: string, removalPolicy: 'destroy' | 'retain') =>
  Template.fromStack(
    new PersonServiceStack(new App(), `S-${stage}`, {
      stage,
      config: { removalPolicy },
    }),
  );

test('dev stack has on-demand table, bus, POST /person', () => {
  const t = synth('dev', 'destroy');
  t.hasResourceProperties('AWS::DynamoDB::Table', { BillingMode: 'PAY_PER_REQUEST', TableName: 'person-service-dev' });
  t.hasResourceProperties('AWS::Events::EventBus', { Name: 'person-service-dev' });
  t.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'POST', AuthorizationType: 'AWS_IAM' });
  t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
  });
  t.hasResourceProperties('AWS::Pipes::Pipe', {
    TargetParameters: { EventBridgeEventBusParameters: { Source: 'com.example.person-service', DetailType: 'PersonCreated' } },
    SourceParameters: Match.objectLike({ DynamoDBStreamParameters: Match.objectLike({ DeadLetterConfig: Match.anyValue() }) }),
  });
});

test('exposes IAM-protected GET /person/{personId}', () => {
  const t = synth('dev', 'destroy');
  t.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: '{personId}' });
  t.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'GET', AuthorizationType: 'AWS_IAM' });
});

test('has a gsi and an IAM-protected GET /person', () => {
  const t = synth('dev', 'destroy');
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    GlobalSecondaryIndexes: [
      Match.objectLike({
        IndexName: 'gsi1',
        KeySchema: [
          { AttributeName: 'gsi1pk', KeyType: 'HASH' },
          { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
        ],
      }),
    ],
  });
  t.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'GET', AuthorizationType: 'AWS_IAM', ResourceId: Match.anyValue() });
});

test('prod table is retained with point in time recovery', () => {
  const t = synth('prod', 'retain');
  t.hasResource('AWS::DynamoDB::Table', {
    DeletionPolicy: 'Retain',
    Properties: {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    },
  });
});
