const router = express.Router();

router.get('/generate-upload-url', async (req, res) => {
  const { fileName, fileType, folder = 'uploads' } = req.query;

  const key = `${folder}/${Date.now()}-${fileName}`;

  const params = {
    Bucket: 'your-bucket-name',
    Key: key,
    ContentType: fileType,
    ACL: 'public-read',
    Expires: 60, // URL expires in 60 seconds
  };

  try {
    const uploadURL = await s3.getSignedUrlPromise('putObject', params);
    res.send({ uploadURL, key });
  } catch (err) {
    console.error('Error generating signed URL:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

module.exports = router;

