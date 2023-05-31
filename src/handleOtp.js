const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const { KmsKeyringNode, buildClient, CommitmentPolicy } = require("@aws-crypto/client-node");
const AWSXray = require("aws-xray-sdk");
const { v4: uuidv4 } = require("uuid");
const ddb = AWSXray.captureAWSv3Client(new DynamoDBClient({}));
const { encrypt, decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT);

const generatorKeyId = process.env.KMS_KEY_ID;
const keyIds = [process.env.KMS_KEY_ARN];
const keyring = new KmsKeyringNode({ generatorKeyId, keyIds });

async function encryptOtp(sub, deviceId, otp) {    
    const context = { 
        stage: 'application',
        origin: sub,
        deviceId: deviceId
    }
    const { result } = await encrypt(keyring, otp, {
        encryptionContext: context,
    });
    return result;
}

async function decryptOtp(sub, encryptedData) {
    const { plaintext, messageHeader } = await decrypt(keyring, encryptedData);
    const { encryptionContext } = messageHeader;
    const status = 'SUCCESS';
    if (encryptionContext.origin !== sub) {
        status = 'ERROR';
    }
    return { 
        status,
        plaintext,
        messageHeader,
    }
}

exports.handler = async function (event, context) {
    // requires sub from Cognito and a deviceId from an user endpoint device
    if (event.path === '/generateOtp') {
        const otp = await encryptOtp(event.queryStringParameters.sub, event.queryStringParameters.deviceId, uuidv4()); // encrypt otp using KMS
        const timestamp = Math.floor(Date.now() / 1000); // current timestamp in seconds
        const ttl = timestamp + process.env.TTL_DURATION; // 1 minute TTL
        const createdAt = timestamp.toString();
        const params = {
            TableName: process.env.OTP_TABLE_NAME,
            Item: {
                "clientId": { 
                    S: event.queryStringParameters.sub
                },
                "createdAt": { 
                    S: createdAt
                },
                "deviceId": { 
                    S: event.queryStringParameters.deviceId
                },
                "otp": { 
                    S: Buffer.from(otp).toString('base64') //base64 encoded to make it easier to store in DynamoDB
                },
                "ttl": { 
                    N: `${ttl}`
                }
            },
        };
        
        await ddb.send(new PutItemCommand(params));
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'OTP generated',
                createdAt: timestamp,
                otp: otp,
            })
        };
    }

    // requires sub, createdAt and deviceId from the generateOtp endpoint
    if (event.path === '/validateOtp') {
        const params = {
            TableName: process.env.OTP_TABLE_NAME,
            "Key": {
                "clientId": { 
                    "S": event.queryStringParameters.sub
                },
                "createdAt": {  
                    "S": event.queryStringParameters.createdAt
                },
            },
        };
        const response = await ddb.send(new GetItemCommand(params));
        if (response.Item.deviceId.S === event.queryStringParameters.deviceId) {
            const result = await decryptOtp(event.queryStringParameters.sub, Buffer.from(response.Item.otp.S, 'base64'));
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'OTP validated',
                    ttl: response.Item.ttl.N,
                    otp: Buffer.from(result.plaintext).toString('ascii'),
                })
            };
        } else {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'OTP validation failed',
                    ttl: response.Item.ttl.N,
                    otp: await decryptOtp(event.queryStringParameters.sub, Buffer.from(response.Item.otp.S, 'base64')),
                    deviceIdFound: response.Item.deviceId.S,
                })
            };
        };
    }

    // requires sub, createdAt and deviceId from the generateOtp endpoint
    if (event.path === '/invalidateOtp') {
        const params = {
            TableName: process.env.OTP_TABLE_NAME,
            "Key": {
                "clientId": { 
                    "S": event.queryStringParameters.sub
                },
                "createdAt": {
                    "S": event.queryStringParameters.createdAt
                }
            },
        };
        await ddb.send(new DeleteItemCommand(params));
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'OTP deleted',
            })
        };
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Path not found',
        })
    };
};