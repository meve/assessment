import { App } from 'aws-cdk-lib';
import { PersonServiceStack } from '../lib/person-service-stack';

const app = new App();
const stage: string = app.node.tryGetContext('stage') ?? 'dev';
const config = app.node.tryGetContext('stages')?.[stage];
if (!config) {
  throw new Error(`Unknown stage "${stage}".`);
}

new PersonServiceStack(app, `PersonService-${stage}`, {
  stage,
  config,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
