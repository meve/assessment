import * as path from 'path';
import { Filter, FilterPattern, Pipe } from '@aws-cdk/aws-pipes-alpha';
import { LambdaEnrichment } from '@aws-cdk/aws-pipes-enrichments-alpha';
import { DynamoDBSource, DynamoDBStartingPosition } from '@aws-cdk/aws-pipes-sources-alpha';
import { EventBridgeTarget } from '@aws-cdk/aws-pipes-targets-alpha';
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EVENT_SOURCE, PERSON_CREATED } from '../src/events';
import { GSI1 } from '../src/person';

export interface StageConfig {
  removalPolicy: 'destroy' | 'retain';
}

export interface PersonServiceStackProps extends StackProps {
  stage: string;
  config: StageConfig;
}

export class PersonServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: PersonServiceStackProps) {
    super(scope, id, props);
    const { stage, config } = props;
    const isProd = config.removalPolicy === 'retain';  // assuming retaining means production
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const table = new dynamodb.Table(this, 'PersonTable', {
      tableName: `person-service-${stage}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      removalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: GSI1,
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const bus = new events.EventBus(this, 'EventBus', { eventBusName: `person-service-${stage}` });

    const createPerson = new NodejsFunction(this, 'CreatePersonFunction', {
      entry: path.join(__dirname, '../src/handlers/create-person.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: new logs.LogGroup(this, 'CreatePersonLogs', {
        retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
        removalPolicy,
      }),
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantWriteData(createPerson);

    const getPerson = new NodejsFunction(this, 'GetPersonFunction', {
      entry: path.join(__dirname, '../src/handlers/get-person.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadData(getPerson);

    const listPersons = new NodejsFunction(this, 'ListPersonsFunction', {
      entry: path.join(__dirname, '../src/handlers/list-persons.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadData(listPersons);

    const enricher = new NodejsFunction(this, 'PersonCreatedEnricher', {
      entry: path.join(__dirname, '../src/handlers/person-created-enricher.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
    });

    const pipeDlq = new sqs.Queue(this, 'PersonCreatedPipeDlq', {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      removalPolicy,
    });

    new Pipe(this, 'PersonCreatedPipe', {
      pipeName: `person-service-${stage}-person-created`,
      source: new DynamoDBSource(table, {
        startingPosition: DynamoDBStartingPosition.LATEST,
        batchSize: 10,
        maximumRetryAttempts: 5,
        deadLetterTarget: pipeDlq,
      }),
      filter: new Filter([
        FilterPattern.fromObject({
          eventName: ['INSERT'],
          dynamodb: { NewImage: { entityType: { S: ['PERSON'] } } },
        }),
      ]),
      enrichment: new LambdaEnrichment(enricher),
      target: new EventBridgeTarget(bus, { source: EVENT_SOURCE, detailType: PERSON_CREATED }),
    });

    const api = new apigw.RestApi(this, 'PersonApi', {
      restApiName: `person-service-${stage}`,
      deployOptions: {
        stageName: stage,
      },
    });
    const personResource = api.root.addResource('person');
    personResource.addMethod('GET', new apigw.LambdaIntegration(listPersons), {
      authorizationType: apigw.AuthorizationType.IAM,
    });
    personResource
      .addResource('{personId}')
      .addMethod('GET', new apigw.LambdaIntegration(getPerson), { authorizationType: apigw.AuthorizationType.IAM });
    personResource
      .addMethod('POST', new apigw.LambdaIntegration(createPerson), {
        authorizationType: apigw.AuthorizationType.IAM,
        requestValidator: new apigw.RequestValidator(this, 'BodyValidator', {
          restApi: api,
          validateRequestBody: true,
        }),
        requestModels: {
          'application/json': new apigw.Model(this, 'CreatePersonModel', {
            restApi: api,
            contentType: 'application/json',
            schema: { type: apigw.JsonSchemaType.OBJECT },
          }),
        },
      });

    new CfnOutput(this, 'ApiUrl', { value: api.url });
    new CfnOutput(this, 'EventBusName', { value: bus.eventBusName });
  }
}
