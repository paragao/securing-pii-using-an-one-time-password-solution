const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const { v4: uuidv4 } = require("uuid");
const ddb = new DynamoDBClient({});

exports.handler = async function (event, context) {
    console.log(event);
    if (event.path === '/generateOtp') {
        const params = {
            TableName: process.env.OTP_TABLE_NAME,
            Item: {
                "clientId": { 
                    "S": event.queryStringParameters.clientId
                },
                "createdAt": { 
                    "S": event.queryStringParameters.createdAt
                },
                "otp": { 
                    "S": uuidv4()
                },
                "ttl": { 
                    "N": event.queryStringParameters.ttl
                }
            },
        };
        
        await ddb.send(new PutItemCommand(params));
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'OTP generated',
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
            AttributesToGet: [
                "otp",
                "ttl"
            ],
        };

        await ddb.send(new GetItemCommand(params));
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'OTP validated'
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