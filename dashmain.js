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

app.get('/income/sum/all', async (req, res) => {
    try {
        const result1 = await req.db.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM bills
            WHERE DATE(generated_at) = CURRENT_DATE AND status = 'paid';
        `);

        const result2 = await req.db.query(`
            SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM web_bills
            WHERE DATE(generated_at) = CURRENT_DATE AND status = 'paid';
        `);

        const totalIncome = result1.rows[0].total_revenue + result2.rows[0].total_revenue;

        res.json({ total_income: totalIncome });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


app.get('/income/group', async (req, res) => {
    try {
        const timeGroup = req.query.groupBy || 'day'; 
        const validGroups = ['day', 'week', 'month'];

        if (!validGroups.includes(timeGroup)) {
            return res.status(400).json({ error: 'Invalid groupBy value' });
        }

        const query = `
            SELECT 
                DATE_TRUNC('${timeGroup}', generated_at) AS period, 
                SUM(total_amount) AS total_revenue
            FROM (
                SELECT generated_at, total_amount FROM bills WHERE status = 'paid'
                UNION ALL
                SELECT generated_at, total_amount FROM web_bills WHERE status = 'paid'
            ) AS combined_data
            GROUP BY period
            ORDER BY period;
        `;

        const result = await req.db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

  

