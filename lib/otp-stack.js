const { Stack, Duration } = require('aws-cdk-lib');
const { LambdaRestApi, Cors } = require('aws-cdk-lib/aws-apigateway');
const { Table, AttributeType, BillingMode } = require('aws-cdk-lib/aws-dynamodb');
const { Function, Runtime, Code, Architecture } = require('aws-cdk-lib/aws-lambda');
const path = require('path');

class OtpStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // DynamoDB table to store OTPs
    const otpTable = new Table(this, "OtpTable", {
      partitionKey: {
        name: "clientId",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
    });

    // Lambda function to generate and validate an OTP
    const otpFunction = new Function(this, "OtpFunction", {
      runtime: Runtime.NODEJS_18_X,
      handler: "handleOtp.handler",
      code: Code.fromAsset(path.join(__dirname, "../src/"), {
        //bundling: {
        //  image: Runtime.NODEJS_18_X.bundlingImage,
        //  command: ["bash", "-c", ["npm install && npm run build"]],
        //},
      }),
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        OTP_TABLE_NAME: otpTable.tableName,
      },
    });
    otpTable.grantReadWriteData(otpFunction);
    
    // API exposed to both client and server
    const api = new LambdaRestApi(this, "OtpApi", {
      handler: otpFunction,
      proxy: false,
      timeout: Duration.seconds(30),
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ["*"],
        maxAge: Duration.seconds(300),
        allowCredentials: true,
        exposeHeaders: ["*"],
        allowOriginString: "*",
      },
    });

    // path to generate an OTP - the client application calls this API to get an OTP and embedd on the backend call
    // method is POST to allow the client to send custom metadata to be associated with the OTP - ex: clientID, sesionID, etc
    const generateOtp = api.root.addResource("generateOtp");
    generateOtp.addMethod("POST");

    // path to validate an OTP - the backend application calls this API to validate an OTP
    // method is GET to allow the server to validate an OTP.
    const validateOtp = api.root.addResource("validateOtp");
    validateOtp.addMethod("GET");

    // path to invalidate an OTP - the backend application calls this API to invalidate an OTP
    // method is DELETE to allow the server to invalidate an OTP.
    const invalidateOtp = api.root.addResource("invalidateOtp");
    invalidateOtp.addMethod("DELETE");
  }
}

module.exports = { OtpStack };
