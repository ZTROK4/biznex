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

router.post('/employees/add', async (req, res) => {
    try {
        const {
            first_name, last_name, email, phone, position,
            salary, bank_name, bank_account_number, ifsc_code,joining_date
        } = req.body;

        if (!first_name || !last_name || !email || !phone || !position ||
            !salary || !bank_name || !bank_account_number || !ifsc_code|| !joining_date) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const query = `
            INSERT INTO employees (
                first_name, last_name, email, phone, position,
                salary, bank_name, bank_account_number, ifsc_code,joining_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,$10)
            RETURNING *;
        `;

        const values = [first_name, last_name, email, phone, position, salary, bank_name, bank_account_number, ifsc_code,joining_date];
        const result = await req.db.query(query, values);

        res.status(201).json({ message: 'Employee added', employee: result.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error', details: error.message });
    }
});

router.get('/employees', async (req, res) => {
    try {
        const query = `SELECT * FROM employees ORDER BY created_at DESC;`;
        const result = await req.db.query(query);

        res.status(200).json({ employees: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database query failed', details: error.message });
    }
});

router.put('/employees', async (req, res) => {
    try {
        const {
            id,
            salary,
            position,
            email,
            phone,
            bank_name,
            bank_account_number,
            ifsc_code,
            joining_date
        } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'Employee ID is required' });
        }

        const updates = [];
        const values = [];
        let index = 1;

        if (salary !== undefined) {
            updates.push(`salary = $${index++}`);
            values.push(salary);
        }
        if (position !== undefined) {
            updates.push(`position = $${index++}`);
            values.push(position);
        }
        if (email !== undefined) {
            updates.push(`email = $${index++}`);
            values.push(email);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${index++}`);
            values.push(phone);
        }
        if (bank_name !== undefined) {
            updates.push(`bank_name = $${index++}`);
            values.push(bank_name);
        }
        if (bank_account_number !== undefined) {
            updates.push(`bank_account_number = $${index++}`);
            values.push(bank_account_number);
        }
        if (ifsc_code !== undefined) {
            updates.push(`ifsc_code = $${index++}`);
            values.push(ifsc_code);
        }
        if (joining_date !== undefined) {
            updates.push(`joining_date = $${index++}`);
            values.push(joining_date);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields provided for update' });
        }

        // Add updated_at column update
        updates.push(`updated_at = NOW()`);

        values.push(id); // ID as the last parameter
        const query = `
            UPDATE employees
            SET ${updates.join(', ')}
            WHERE id = $${index}
            RETURNING *;
        `;

        const result = await req.db.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ message: 'Employee updated successfully', employee: result.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database update failed', details: error.message });
    }
});

router.post('/delete-employee', async (req, res) => {
    try {
        const { id } = req.body;

        const result = await req.db.query('DELETE FROM employees WHERE id = $1 RETURNING *;', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ message: 'Employee deleted successfully', employee: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database delete failed', details: error.message });
    }
});


module.exports = router;