const express = require('express');
const session = require('express-session');
const router = express.Router();
const passport = require('passport');
const masterPool = require('./master_db');


router.post('/list_job', async (req, res) => {
    const { jobtitle, desc, location, salary } = req.body;

    // Check for missing fields
    if (!jobtitle || !desc || !location || !salary) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Ensure user is logged in
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        // Insert job into job_list table
        const result = await masterPool.query(
            `INSERT INTO job_list (jobtitle, client_id, desc, location, salary_range, status) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING client_id;`,
            [jobtitle, req.session.user.id, desc, location, salary, 'open']
        );

        // Check if insertion was successful
        if (result.rows.length === 0) {
            return res.status(500).json({ error: "Error in listing job" });
        }

        return res.status(201).json({ message: "Job Listed Successfully" });
    } catch (err) {
        console.error('Error in listing:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/delete_job', async (req, res) => {
    const { job_id } = req.body;

    // Check for missing fields
    if (!job_id ) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
        // Check if the user session exists
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        // Query to get job list for the logged-in user
        const result = await masterPool.query(`UPDATE job_list SET status='closed' where job_id = $1;`, [job_id]);

        // Return the list of jobs
        return res.status(200).json({
            message: "Deleted Successfully",
            jobs: result.rows
        });
    } catch (err) {
        console.error('Error in listing:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/get_job_list', async (req, res) => {
    try {
        // Check if the user session exists
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: "Unauthorized: User not logged in" });
        }

        // Query to get job list for the logged-in user
        const result = await masterPool.query(`SELECT * FROM job_list WHERE client_id = $1 and status='open';`, [req.session.user.id]);

        // Check if no jobs were found
        if (result.rows.length === 0) { 
            return res.status(404).json({ error: "No jobs found for this user" });
        }

        // Return the list of jobs
        return res.status(200).json({
            message: "Job Listed Successfully",
            jobs: result.rows
        });
    } catch (err) {
        console.error('Error in listing:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
module.exports = router;