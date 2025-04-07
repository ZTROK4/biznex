const express = require('express');
const AWS = require('aws-sdk');
const router = express.Router();
require('dotenv').config();

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION, // e.g. 'us-east-1'
});

const s3 = new AWS.S3();

router.get('/generate-upload-url', async (req, res) => {
  const { fileName, fileType, folder = 'uploads' } = req.query;

  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'Missing fileName or fileType' });
  }

  const key = `${folder}/${Date.now()}-${fileName}`;

  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    ContentType: fileType,
    ACL: 'public-read',
    Expires: 60, // Expires in 60 seconds
  };

  try {
    const uploadURL = await s3.getSignedUrlPromise('putObject', params);
    res.status(200).json({ uploadURL, key });
  } catch (err) {
    console.error('Error generating signed URL:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

module.exports = router;
