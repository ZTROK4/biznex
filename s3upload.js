const AWS = require('aws-sdk');
require('dotenv').config();


const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION,
});

router.get('/generate-upload-url', async (req, res) => {
  const fileName = req.query.fileName;
  const fileType = req.query.fileType;

  const params = {
    Bucket: 'your-bucket-name',
    Key: `uploads/${Date.now()}-${fileName}`,
    ContentType: fileType,
    ACL: 'public-read',
    Expires: 60, // expires in 60 seconds
  };

  const uploadURL = await s3.getSignedUrlPromise('putObject', params);
  res.send({ uploadURL, key: params.Key });
});
