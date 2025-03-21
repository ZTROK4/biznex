const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');

app.use((req, res, next) => {
    if (!req.session.db_name) {
        return res.status(400).json({ error: 'No database selected. Please log in first.' });
    }

    if (!pool || pool.options.database !== req.session.db_name) {
        pool = new pg.Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
        });
    }

    req.db = pool;
    next();
});

app.get('/api/some-data', async (req, res) => {
    try {
        const result = await req.db.query('SELECT * FROM some_table');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});