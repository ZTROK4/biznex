const express = require('express');
const jwt = require('jsonwebtoken');
const pg = require('pg');
const router = express.Router();
const moment = require('moment');

router.use(async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(400).json({ error: 'No token provided. Please log in first.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.dbname = decoded.dbname; 

        const db = new pg.Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: req.dbname,  
        });

        req.db = db; 
        next(); 
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
});
router.post('/create', async (req, res) => {
    try {
        const { file_url, description } = req.body;

        const query = `
            INSERT INTO documents (file_url, description, created_at)
            VALUES ($1, $2, NOW())
            RETURNING document_id, file_url, description, created_at;
        `;

        const values = [file_url, description];

        const result = await req.db.query(query, values);

        res.status(201).json({ document: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to insert document', details: error.message });
    }
});

router.get('/documents', async (req, res) => {
    try {
        const query = `
            SELECT 
                document_id, 
                file_url, 
                description, 
                created_at
            FROM documents
            ORDER BY created_at DESC;
        `;

        const result = await req.db.query(query);

        res.status(200).json({ documents: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch documents', details: error.message });
    }
});




module.exports = router;