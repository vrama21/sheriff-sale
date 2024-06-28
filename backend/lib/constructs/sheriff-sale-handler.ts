import { Construct } from 'constructs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface SheriffSaleHandlerProps extends NodejsFunctionProps {}

export class SheriffSaleHandler extends NodejsFunction {
  constructor(scope: Construct, id: string, props: SheriffSaleHandlerProps) {
    const { DATABASE_URL, ENV } = process.env;

    if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
    if (!ENV) throw new Error('ENV not set');

    const defaultEnvironment = {
      DATABASE_URL,
      ENV,
    };

    super(scope, id, {
      ...props,
      environment: {
        ...defaultEnvironment,
        ...props.environment,
      },
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
    });
  }
}
