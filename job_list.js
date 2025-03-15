const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');

// ✅ List Job
router.post('/list_job', async (req, res) => {
    const { jobtitle, desc, location, salary } = req.body;

    if (!jobtitle || !desc || !location || !salary) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        const result = await masterPool.query(
            `INSERT INTO job_list (jobtitle, client_id, desc, location, salary_range, status) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING client_id;`,
            [jobtitle, req.session.user.id, desc, location, salary, 'open']
        );

        if (result.rows.length === 0) {
            return res.status(500).json({ error: "Error in listing job" });
        }

        return res.status(201).json({ message: "Job Listed Successfully" });
    } catch (err) {
        console.error('Error in listing:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ Delete Job (Fixed to use POST and check client_id)
router.post('/delete_job', async (req, res) => {
    const { job_id } = req.body;

    if (!job_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        // Only allow deleting if the job belongs to the logged-in user
        const result = await masterPool.query(
            `UPDATE job_list SET status='closed' WHERE job_id = $1 AND client_id = $2 RETURNING *;`,
            [job_id, req.session.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Job not found or unauthorized" });
        }

        return res.status(200).json({ message: "Deleted Successfully" });
    } catch (err) {
        console.error('Error in deleting:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ✅ Get Job List
router.get('/get_job_list', async (req, res) => {
    try {
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        const result = await masterPool.query(
            `SELECT * FROM job_list WHERE client_id = $1 AND status='open';`,
            [req.session.user.id]
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

module.exports = router;
