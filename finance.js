const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');

router.use((req, res, next) => {
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

//1- add payyable accounts
router.post('/add-pay-acc', async (req, res) => {
    try {
        const { account_name, amount, payment_date, payment_method, status } = req.body;

        if (!account_name || !amount || !payment_date || !payment_method || !status) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const query = `
            INSERT INTO accounts_payable (account_name, amount, payment_date, payment_method, status)
            VALUES ($1, $2, $3, $4, $5) RETURNING *;
        `;

        const values = [account_name, amount, payment_date, payment_method, status];

        const result = await req.db.query(query, values);

        res.status(201).json({ message: 'Account Payable added successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error adding payable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//2- add receivable accounts
router.post('/add-recv-acc', async (req, res) => {
    try {
        const { account_name, amount, due_date, status } = req.body;

        if (!account_name || !amount || !due_date || !status) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const query = `
            INSERT INTO accounts_receivable (account_name, amount, due_date, status)
            VALUES ($1, $2, $3, $4) RETURNING *;
        `;

        const values = [account_name, amount, due_date, status];

        const result = await req.db.query(query, values);

        res.status(201).json({ message: 'Account Receivable added successfully', data: result.rows[0] });
    } catch (error) {
        console.error('Error adding receivable account:', error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//3-update status payyable account
router.put('/update-pay-acc', async (req, res) => {
    try {
        const { id, status } = req.body; 

        if (!id || !status) {
            return res.status(400).json({ error: 'ID and status are required' });
        }

        const query = `
            UPDATE payable_accounts
            SET status = $1
            WHERE id = $2
            RETURNING *;
        `;

        const result = await req.db.query(query, [status, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Payable account not found' });
        }

        res.json({ message: 'Status updated successfully', updatedAccount: result.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


//4- update status receivable account
router.put('/update-recv-acc', async (req, res) => {
    try {
        const { id, status } = req.body; 

        if (!id || !status) {
            return res.status(400).json({ error: 'ID and status are required' });
        }

        const query = `
            UPDATE receivable_accounts
            SET status = $1
            WHERE id = $2
            RETURNING *;
        `;

        const result = await req.db.query(query, [status, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Receivable account not found' });
        }

        res.json({ message: 'Status updated successfully', updatedAccount: result.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

//5- display the payyable accounts
router.get('/payable-accounts', async (req, res) => {
    try {
        const result = await req.db.query('SELECT * FROM accounts_payable ORDER BY created_at DESC;');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});


//6- display the receivabel accounts
router.get('/receivable-accounts', async (req, res) => {
    try {
        const result = await req.db.query('SELECT * FROM accounts_receivable ORDER BY created_at DESC;');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed' });
    }
});

module.exports = router;