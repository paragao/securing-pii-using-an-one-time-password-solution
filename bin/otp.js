#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const { OtpStack } = require('../lib/otp-stack');

const app = new cdk.App();
new OtpStack(app, 'OtpStack', {
  env: { region: process.env.REGION },
});
