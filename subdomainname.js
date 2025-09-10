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


router.post('/subdomainin', async (req, res) => {
    try {
        const client_id = req.client_id;
        const { subdomain } = req.body;

        const query = `
            UPDATE clients
            SET subdomain = $2
            WHERE client_id = $1
            RETURNING client_id;

        `;

        const result = await masterPool.query(query, [client_id, subdomain]);

        return res.status(200).json({
            message: 'Subdomain saved successfully'
        });

    } catch (error) {
        if (error.code === '23505' && error.constraint === 'unique_subdomain') {
            // 23505 is the PostgreSQL unique violation error code
            return res.status(400).json({ error: 'Subdomain already exists for another client.' });
        }

        console.error('Error saving subdomain:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


router.get('/subdomainname', async (req, res) => {
    try {
        const client_id = req.client_id;

        const result = await masterPool.query(
            'SELECT subdomain FROM clients WHERE client_id = $1',
            [client_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        const subdomain = result.rows[0].subdomain;

        return res.status(200).json({ subdomain: subdomain });
    } catch (error) {
        console.error("Error fetching subdomain:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


router.get('/orders', async (req, res) => {
    const client = await req.db.connect();

    try {
        // First, get all orders
        const ordersResult = await client.query(
            `SELECT order_id, total_price, status, created_at FROM orders ORDER BY created_at DESC`
        );
        const orders = ordersResult.rows;

        // For each order, fetch its items
        for (let order of orders) {
            const itemsResult = await client.query(
                `SELECT order_item_id, product_id, quantity, unit_price 
                 FROM order_item WHERE order_id = $1`,
                [order.order_id]
            );
            order.items = itemsResult.rows;
        }

        res.status(200).json({
            success: true,
            orders: orders
        });

    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve orders',
            error: error.message
        });
    } finally {
        client.release();
    }
    
});



module.exports = router;
