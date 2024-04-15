require("dotenv").config();
const { fs } =require("./fs_utils")
const AWS = require("aws-sdk");

// Configure AWS SDK
AWS.config.update({
    region: "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3(); 



async function upload(key,filePath){
    return new Promise((resolve,reject)=>{
        const bucketName = 'deploystorage'; // Change this to your bucket name
        const fileName = filePath;
        
        // Set the parameters for the upload
        const params = {
        Bucket: bucketName,
        Key: key,
        Body: fs.readFileSync(filePath)
        };
        
        // Upload the file
        s3.upload(params, function(err, data) {
        if (err) {
            reject()
        } else {
            console.log("@ aws.js/upload: File uploaded successfully:", data.Location);
            resolve();
        }
        });
    })
}
const ecr = new AWS.ECR({ region: "us-west-1"})
module.exports = {
    AWS, s3, upload, ecr
}
