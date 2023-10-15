const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");
const AWSXray = require("aws-xray-sdk");
const ddb = AWSXray.captureAWSv3Client(new DynamoDBClient({}));

exports.handler = async function (event, context) {
    const params = {
        TableName: process.env.USER_DATA_TABLE_NAME,
        Item: {
            "subId": { 
                S: event.request.userAttributes.sub,
            },
            "email": {
                S: event.request.userAttributes.email,
            }
        },
    };
    await ddb.send(new PutItemCommand(params));
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'User added successfully',
        })
    };
};