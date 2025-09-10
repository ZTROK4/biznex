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
        let client_id = decoded.id;  
        client_id=parseInt(client_id);
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

router.get('/client_details', async (req, res) => {
    try {
        const clientId = req.client_id;

        const result = await masterPool.query('SELECT * FROM clients WHERE client_id = $1', [clientId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }

        const clientDetails = result.rows[0];
        res.json({ client: clientDetails });
    } catch (error) {
        console.error("Error fetching client details:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/check_password', async (req, res) => {
    try {
        const clientId = req.client_id;
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required.' });
        }

        // Fetch stored hash from the database
        const result = await masterPool.query('SELECT password FROM clients WHERE client_id = $1', [clientId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }

        const storedHash = result.rows[0].password;

        // Compare provided password with the stored hash
        const isMatch = await bcrypt.compare(password, storedHash);

        if (isMatch) {
            return res.json({ message: 'Password is correct.' });
        } else {
            return res.status(401).json({ error: 'Incorrect password.' });
        }
    } catch (error) {
        console.error("Error checking password:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/update_client', async (req, res) => {
    try {
        const clientId = req.client_id;
        const {
            client_name,
            owner_name,
            email,
            ph_no,
            address,
            business_category,
            password
        } = req.body;

        // Build update query dynamically based on provided fields
        let fields = [];
        let values = [];
        let index = 1;

        if (client_name) {
            fields.push(`client_name = $${index++}`);
            values.push(client_name);
        }
        if (owner_name) {
            fields.push(`owner_name = $${index++}`);
            values.push(owner_name);
        }
        if (email) {
            fields.push(`email = $${index++}`);
            values.push(email);
        }
        if (ph_no) {
            fields.push(`ph_no = $${index++}`);
            values.push(ph_no);
        }
        if (address) {
            fields.push(`address = $${index++}`);
            values.push(address);
        }
        if (business_category) {
            fields.push(`business_category = $${index++}`);
            values.push(business_category);
        }
        if (password) {
            // Hash the new password before saving
            const hashedPassword = await bcrypt.hash(password, 10);
            fields.push(`password_hash = $${index++}`);
            values.push(hashedPassword);
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No fields to update.' });
        }

        values.push(clientId); // For WHERE clause
        const query = `UPDATE clients SET ${fields.join(', ')} WHERE client_id = $${index}`;

        await masterPool.query(query, values);

        res.json({ message: 'Client details updated successfully.' });
    } catch (error) {
        console.error("Error updating client details:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;