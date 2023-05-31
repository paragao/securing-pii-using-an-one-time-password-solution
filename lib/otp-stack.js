const { Stack, Duration, RemovalPolicy } = require('aws-cdk-lib');
const { LambdaRestApi, Cors } = require('aws-cdk-lib/aws-apigateway');
const { Table, AttributeType, BillingMode } = require('aws-cdk-lib/aws-dynamodb');
const { Function, Runtime, Code, Architecture, Tracing } = require('aws-cdk-lib/aws-lambda');
const { Key } = require('aws-cdk-lib/aws-kms');
const { UserPool, OAuthScope, VerificationEmailStyle } = require('aws-cdk-lib/aws-cognito');
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

    // DynamoDB table to store user data (could be a single table desing - lazyness took over - TODO: refactor)
    const userDataTable = new Table(this, "UserDataTable", {
      partitionKey: {
        name: "subId",
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      tracing: Tracing.ACTIVE,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    
    // Function called by Amazon Cognito to sync new users
    const syncNewUserFn = new Function(this, "SyncNewUserFn", {
      runtime: Runtime.NODEJS_18_X,
      handler: "syncNewUser.handler",
      code: Code.fromAsset(path.join(__dirname, "../src/")),
      architecture: Architecture.ARM_64,
      environment: {
        USER_DATA_TABLE_NAME: userDataTable.tableName,
      },
      tracing: Tracing.ACTIVE,
      timeout: Duration.seconds(30),
      memorySize: 256,
    });
    userDataTable.grantReadWriteData(syncNewUserFn);

    // Amazon Cognito to simulate the customer's OAuth2
    const userPool = new UserPool(this, "UserPool", {
      removalPolicy: RemovalPolicy.DESTROY,
      lambdaTriggers: {
        postConfirmation: syncNewUserFn,
      },
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: false,
      },
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      userVerification: {
        emailSubject: "OTP demo - Verification code",
        emailBody:
          "Your verification code is {####} . Use it to complete your registration!",
        emailStyle: VerificationEmailStyle.CODE,
      },
    });
    userPool.addClient('app-client', { 
      oAuth: {
        flows: { 
          authorizationCodeGrant: true,
        },
        scopes: [ OAuthScope.OPENID ],
        callbackUrls: [ 'https://example.com/oauth2/callback' ],
      },
    });
    userPool.addDomain('app-domain', {
      cognitoDomain: {
        domainPrefix: 'otp-demo',
      },
      userPool: userPool,
    });

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
      tracing: Tracing.ACTIVE,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const encryptionKey = new Key(this, "EncryptionKey", {
      enableKeyRotation: true,
      enabled: true,
      alias: "otpEncryptionKey",
      removalPolicy: RemovalPolicy.DESTROY,
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
        KMS_KEY_ID: encryptionKey.keyId,
        KMS_KEY_ARN: encryptionKey.keyArn,
        TTL_DURATION: '60',
      },
    });
    otpTable.grantReadWriteData(otpFunction);
    encryptionKey.grantEncryptDecrypt(otpFunction);
    
    // API exposed to both client and server
    const otpApi = new LambdaRestApi(this, "OtpApi", {
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
      deployOptions: {
        tracingEnabled: true,
        metricsEnabled: true,
      },
    });

    // path to generate an OTP - the client application calls this API to get an OTP and embedd on the backend call
    // method is POST to allow the client to send custom metadata to be associated with the OTP - ex: clientID, sesionID, etc
    const generateOtp = otpApi.root.addResource("generateOtp");
    generateOtp.addMethod("POST");

    // path to validate an OTP - the backend application calls this API to validate an OTP
    // method is GET to allow the server to validate an OTP.
    const validateOtp = otpApi.root.addResource("validateOtp");
    validateOtp.addMethod("GET");

    // path to invalidate an OTP - the backend application calls this API to invalidate an OTP
    // method is DELETE to allow the server to invalidate an OTP.
    const invalidateOtp = otpApi.root.addResource("invalidateOtp");
    invalidateOtp.addMethod("DELETE");
  }
}

module.exports = { OtpStack };
