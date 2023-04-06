const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const { KmsKeyringNode, buildClient, CommitmentPolicy } = require("@aws-crypto/client-node");
const AWSXray = require("aws-xray-sdk");
const { v4: uuidv4 } = require("uuid");
const ddb = AWSXray.captureAWSv3Client(new DynamoDBClient({}));
const { encrypt, decrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT);

const generatorKeyId = process.env.KMS_KEY_ID;
const keyIds = [process.env.KMS_KEY_ARN];
const keyring = new KmsKeyringNode({ generatorKeyId, keyIds });

async function encryptOtp(clientId, otp) {    
    const context = { 
        stage: 'application',
        purpose: 'avoid man in the middle attacks',
        origin: clientId
    }
    const { result } = await encrypt(keyring, otp, {
        encryptionContext: context,
    });
    return result;
}

async function decryptOtp(clientId, encryptedData) {
    const { plaintext, messageHeader } = await decrypt(keyring, encryptedData);
    const { encryptionContext } = messageHeader;
    const status = 'SUCCESS';
    if (encryptionContext.origin !== clientId) {
        status = 'ERROR';
    }
    return { 
        status,
        plaintext,
        messageHeader,
    }
}

exports.handler = async function (event, context) {
    console.log(event);
    if (event.path === '/generateOtp') {
        const otp = await encryptOtp(event.queryStringParameters.clientId, uuidv4()); // encrypt otp using KMS
        const timestamp = Math.floor(Date.now() / 1000); // current timestamp in seconds
        const ttl = timestamp + 60; // 1 minute TTL
        const createdAt = timestamp.toString();
        const params = {
            TableName: process.env.OTP_TABLE_NAME,
            Item: {
                "clientId": { 
                    S: event.queryStringParameters.clientId
                },
                "createdAt": { 
                    S: createdAt
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

    if (event.path === '/validateOtp') {
        const params = {
            TableName: process.env.OTP_TABLE_NAME,
            "Key": {
                "clientId": { 
                    "S": event.queryStringParameters.clientId
                },
                "createdAt": {  
                    "S": event.queryStringParameters.createdAt
                }
            },
        };
        const response = await ddb.send(new GetItemCommand(params));
        const result = await decryptOtp(event.queryStringParameters.clientId, Buffer.from(response.Item.otp.S, 'base64'));
        console.log(result);
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'OTP validated',
                ttl: response.Item.ttl.N,
                otp: await decryptOtp(event.queryStringParameters.clientId, Buffer.from(response.Item.otp.S, 'base64')),
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