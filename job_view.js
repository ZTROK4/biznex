const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');
const jwt = require('jsonwebtoken');

// Middleware: Verify JWT and user
router.use(async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(400).json({ error: 'No token provided. Please log in first.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user_id = decoded.id;  

        const result = await masterPool.query(
            'SELECT job_user_id FROM job_user WHERE job_user_id = $1', 
            [user_id]
        );

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
            `SELECT jl.*
             FROM job_list jl
             WHERE jl.status = 'open'
             AND jl.job_id NOT IN (
                 SELECT job_id 
                 FROM job_apply 
                 WHERE job_user_id = $1
             );`,
            [user_id]
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

router.get('/get_applied_jobs', async (req, res) => {
    try {
        const user_id = req.job_user_id; 

        if (!user_id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        const result = await masterPool.query(
            `SELECT 
                ja.job_apply_id,
                jl.company_name,
                jl.job_title,
                ja.status AS application_status,
                ja.applied_at
             FROM job_apply ja
             JOIN job_user ju ON ja.job_user_id = ju.job_user_id
             JOIN job_list jl ON ja.job_id = jl.job_id
             WHERE ja.job_user_id = $1
             ORDER BY ja.applied_at DESC;`,
            [user_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No applied jobs found" });
        }

        return res.status(200).json({
            message: "Applied jobs retrieved successfully",
            applied_jobs: result.rows
        });
    } catch (err) {
        console.error('Error retrieving applied jobs:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.post('/apply_job', async (req, res) => {
    try {
        const { job_id,fileurl } = req.body;
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
            `INSERT INTO job_apply (job_id, job_user_id, applied_at, status,resume) 
             VALUES ($1, $2, NOW(), 'pending',$3);`,
            [job_id, job_user_id,fileurl]
        );

        return res.status(201).json({ message: 'Job application submitted successfully' });
    } catch (err) {
        console.error('Error in job application:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/update_application_status', async (req, res) => {
    try {
        const { job_apply_id, status } = req.body;

        if (!job_apply_id || !status) {
            return res.status(400).json({ error: 'Missing job_apply_id or status' });
        }

        const validStatuses = ['pending', 'reviewed','withdrawn', 'accepted', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }



        // Ensure the job application exists and belongs to a job posted by the client
        const jobCheck = await masterPool.query(
            `SELECT ja.job_id 
             FROM job_apply ja 
             INNER JOIN job_list jl ON ja.job_id = jl.job_id 
             WHERE ja.job_apply_id = $1 ;`,
            [job_apply_id]
        );

        if (jobCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Application not found or unauthorized' });
        }

        // Update the job application status
        await masterPool.query(
            `UPDATE job_apply SET status = $1 WHERE job_apply_id = $2;`,
            [status, job_apply_id]
        );

        return res.status(200).json({ message: 'Application status updated successfully' });

    } catch (err) {
        console.error('Error updating application status:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
module.exports = router;
