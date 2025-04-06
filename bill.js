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

router.post('/cart/checkout', async (req, res) => {
    const client = await req.db.connect();
    try {
        const { status, items, bill } = req.body;

        if (!status || !Array.isArray(items) || items.length === 0 || !bill) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { payment_status, payment_method } = bill;

        const totalPrice = items.reduce((sum, item) => {
            return sum + item.quantity * item.unit_price;
        }, 0);

        await client.query('BEGIN');

        // 1. Create cart
        const cartResult = await client.query(
            `INSERT INTO cart (total_price, status) VALUES ($1, $2) RETURNING cart_id, created_at`,
            [totalPrice, status]
        );
        const cartId = cartResult.rows[0].cart_id;

        // 2. Loop through items
        for (const item of items) {
            const { product_id, quantity, unit_price } = item;

            // Check product stock
            const stockResult = await client.query(
                `SELECT quantity FROM products WHERE id = $1 FOR UPDATE`,
                [product_id]
            );

            if (stockResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: `Product ID ${product_id} not found` });
            }

            const currentStock = stockResult.rows[0].quantity;

            if (currentStock < quantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Insufficient stock for product ID ${product_id}` });
            }

            // Insert cart item
            await client.query(
                `INSERT INTO cart_item (cart_id, product_id, quantity, unit_price)
                 VALUES ($1, $2, $3, $4)`,
                [cartId, product_id, quantity, unit_price]
            );

            // Decrement stock
            await client.query(
                `UPDATE products SET quantity = quantity - $1 WHERE id = $2`,
                [quantity, product_id]
            );
        }

        // 3. Create bill
        const billResult = await client.query(
            `INSERT INTO bills (cart_id, total_amount, payment_status, payment_method)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [cartId, totalPrice, payment_status, payment_method]
        );

        await client.query(
            `INSERT INTO man_incomes (type, description, amount, payment_method, income_date)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                'Sale',
                `Bill for cart_id ${cartId}`,
                totalPrice,
                payment_method,
                new Date() 
            ]
        );
        await client.query('COMMIT');

        res.status(201).json({
            message: 'Checkout successful',
            cart: {
                cart_id: cartId,
                status,
                total_price: totalPrice,
                created_at: cartResult.rows[0].created_at,
                items,
                bill: billResult.rows[0]
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ error: 'Checkout failed', details: error.message });
    } finally {
        client.release();
    }
});


module.exports = router;