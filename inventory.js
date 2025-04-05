const express = require('express');
const router = express.Router();
const masterPool = require('./master_db');

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

router.post('/product', async (req, res) => {
    const { name, category, quantity, barcode, price, type, status } = req.body;

    if (
        !name || typeof name !== 'string' ||
        !category || typeof category !== 'string' ||
        typeof quantity !== 'number' ||
        !barcode || typeof barcode !== 'string' ||
        typeof price !== 'number' ||
        !['offline', 'online', 'both'].includes(type) ||
        !['active', 'inactive'].includes(status)
    ) {
        return res.status(400).json({ error: 'Invalid product data' });
    }

    const createdAt = moment().format('YYYY-MM-DD HH:mm:ss');

    try {
        const result = await req.db.query(
            `INSERT INTO products 
            (name, category, quantity, barcode, price, type, status, created_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
            RETURNING product_id, name, category, quantity, barcode, price, type, status, created_at`,
            [name, category, quantity, barcode, price, type, status, createdAt]
        );

        return res.status(201).json({
            success: true,
            message: 'Product added successfully',
            product: result.rows[0],
        });
    } catch (error) {
        console.error("Database insertion error:", error);
        return res.status(500).json({ error: 'Failed to insert product' });
    }
});


module.exports = router;