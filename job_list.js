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
        const client_id = decoded.id;  

        const result = await masterPool.query('SELECT client_id FROM clients WHERE client_id = $1', [client_id]);

        if (result.rows.length === 0) {

            return res.status(401).json({ error: 'Invalid client ID. Unauthorized access.' });
        }

        req.client_id = client_id;

        next();
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
});

//  List Job
router.post('/list_job', async (req, res) => {
    const { 
        jobtitle, 
        desc, 
        location, 
        salary, 
        company_name, 
        quali_1, 
        quali_2, 
        type, 
        work_type 
    } = req.body;

    if (!jobtitle || !desc || !location || !salary || !company_name || !quali_1 || !quali_2 || !type || !work_type) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const client_id = req.client_id;  

        if (!client_id) {
            return res.status(401).json({ error: "Unauthorized: Client not logged in" });
        }

        const result = await masterPool.query(
            `INSERT INTO job_list (
                job_title, 
                client_id, 
                desc, 
                location, 
                salary_range, 
                status, 
                company_name, 
                quali_1, 
                quali_2, 
                type, 
                work_type
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING job_id;`,
            [jobtitle, client_id, desc, location, salary, 'open', company_name, quali_1, quali_2, type, work_type]
        );

        if (result.rows.length === 0) {
            return res.status(500).json({ error: "Error in listing job" });
        }

        return res.status(201).json({ message: "Job Listed Successfully", job_id: result.rows[0].job_id });
    } catch (err) {
        console.error('Error in listing:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


//  Delete Job 
router.post('/delete_job', async (req, res) => {
    const { job_id } = req.body;

    if (!job_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const client_id = req.client_id; 

        if (!client_id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        const result = await masterPool.query(
            `UPDATE job_list 
             SET status='closed' 
             WHERE job_id = $1 AND client_id = $2 
             RETURNING *;`,
            [job_id, client_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Job not found or unauthorized" });
        }

        return res.status(200).json({ message: "Job deleted (closed) successfully" });
    } catch (err) {
        console.error('Error in deleting job:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

//  Get Job List
router.get('/get_job_list', async (req, res) => {
    try {
        const client_id = req.client_id;  

        if (!client_id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        const result = await masterPool.query(
            `SELECT * FROM job_list WHERE client_id = $1;`,
            [client_id]
        );

        if (result.rows.length === 0) { 
            return res.status(404).json({ error: "No jobs found for this user" });
        }

        return res.status(200).json({
            message: "Jobs retrieved successfully",
            jobs: result.rows
        });
    } catch (err) {
        console.error('Error in retrieving jobs:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/get_job_applicants', async (req, res) => {
    try {
        const { job_id } = req.body;
        const client_id = req.client_id; 

        if (!job_id) {
            return res.status(400).json({ error: 'Missing job_id' });
        }

        if (!client_id) {
            return res.status(401).json({ error: 'Unauthorized: Client not logged in' });
        }

        const jobCheck = await masterPool.query(
            `SELECT * FROM job_list WHERE job_id = $1 AND client_id = $2;`,
            [job_id, client_id]
        );

        if (jobCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or unauthorized access' });
        }

        const applicants = await masterPool.query(
            `SELECT 
                ja.job_apply_id,
                ja.job_id,
                ja.job_user_id,
                ja.applied_at,
                ja.status,
                ju.job_user_name,
                ju.email,
                ju.phone,
                ju.address,
                ju.resume,
                ju.dob,
                ju.image
            FROM job_apply ja
            INNER JOIN job_user ju ON ja.job_user_id = ju.job_user_id
            WHERE ja.job_id = $1;`,
            [job_id]
        );

        return res.status(200).json({
            message: 'Applicants retrieved successfully',
            applicants: applicants.rows
        });

    } catch (err) {
        console.error('Error in fetching applicants:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/update_application_status', async (req, res) => {
    try {
        const { job_apply_id, status } = req.body;
        const client_id = req.client_id; // Extracted from JWT middleware

        if (!job_apply_id || !status) {
            return res.status(400).json({ error: 'Missing job_apply_id or status' });
        }

        const validStatuses = ['pending', 'reviewed', 'accepted', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }

        if (!client_id) {
            return res.status(401).json({ error: 'Unauthorized: Client not logged in' });
        }

        // Ensure the job application exists and belongs to a job posted by the client
        const jobCheck = await masterPool.query(
            `SELECT ja.job_id 
             FROM job_apply ja 
             INNER JOIN job_list jl ON ja.job_id = jl.job_id 
             WHERE ja.job_apply_id = $1 AND jl.client_id = $2;`,
            [job_apply_id, client_id]
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
