const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');

const jwt = require('jsonwebtoken');


router.use(async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(400).json({ error: 'No token provided. Please log in first.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user_id = decoded.id;  

        const result = await masterPool.query('SELECT job_user_id FROM job_user WHERE job_user_id = $1', [user_id]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid user ID. Unauthorized access.' });
        }

        req.job_user_id = user_id; 

        next(); 
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
});

router.get('/get_job_list', async (req, res) => {
    try {
        const user_id = req.job_user_id; 

        if (!user_id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        const result = await masterPool.query(
            `SELECT * FROM job_list WHERE status = 'open';`
        );

        if (result.rows.length === 0) { 
            return res.status(404).json({ error: "No open jobs available" });
        }

        return res.status(200).json({
            message: "Open jobs retrieved successfully",
            jobs: result.rows
        });
    } catch (err) {
        console.error('Error in retrieving jobs:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/apply_job', async (req, res) => {
    try {
        const { job_id } = req.body;
        const job_user_id = req.job_user_id; 

        if (!job_id) {
            return res.status(400).json({ error: 'Missing job_id' });
        }

        if (!job_user_id) {
            return res.status(401).json({ error: 'Unauthorized: User not logged in' });
        }

        const jobCheck = await masterPool.query(
            `SELECT * FROM job_list WHERE job_id = $1 AND status = 'open';`,
            [job_id]
        );

        if (jobCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or no longer available' });
        }

        const existingApplication = await masterPool.query(
            `SELECT * FROM job_apply WHERE job_id = $1 AND job_user_id = $2;`,
            [job_id, job_user_id]
        );

        if (existingApplication.rows.length > 0) {
            return res.status(400).json({ error: 'You have already applied for this job' });
        }

        await masterPool.query(
            `INSERT INTO job_apply (job_id, job_user_id, applied_at, status) 
             VALUES ($1, $2, NOW(), 'pending');`,
            [job_id, job_user_id]
        );

        return res.status(201).json({ message: 'Job application submitted successfully' });
    } catch (err) {
        console.error('Error in job application:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
