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

router.post('/add-category', async (req, res) => {
    const { category } = req.body;

    if (!category || typeof category !== 'string') {
        return res.status(400).json({ error: 'Invalid category data' });
    }

    const createdAt = moment().format('YYYY-MM-DD HH:mm:ss');

    try {
        const result = await req.db.query(
            'INSERT INTO category (category, created_at) VALUES ($1, $2) RETURNING category_id, category, created_at',
            [category, createdAt]
        );

  
        return res.status(201).json({
            success: true,
            message: 'Category added successfully',
            category: result.rows[0],
        });
    } catch (error) {
        console.error("Database insertion error:", error);
        return res.status(500).json({ error: 'Failed to insert category' });
    }
});


router.post('/delete-category', async (req, res) => {
    const { id } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'Category ID is required' });
    }

    try {
        // Check if any product exists with this category
        const checkQuery = `
            SELECT 1 FROM products WHERE category = (
                SELECT category FROM category WHERE category_id = $1
            ) LIMIT 1;
        `;
        const checkResult = await req.db.query(checkQuery, [id]);

        if (checkResult.rowCount > 0) {
            return res.status(409).json({
                success: false,
                message: 'Cannot delete category: Products are using this category.'
            });
        }

        // Proceed with deletion
        const deleteQuery = 'DELETE FROM category WHERE category_id = $1 RETURNING *';
        const deleteResult = await req.db.query(deleteQuery, [id]);

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }

        return res.status(200).json({
            success: true,
            message: 'Category deleted successfully.',
            category: deleteResult.rows[0]
        });
    } catch (error) {
        console.error("Error deleting category:", error);
        return res.status(500).json({ error: 'Failed to delete category' });
    }
});


router.get('/categories', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.category_id, 
                c.category, 
                COUNT(p.id) AS product_count
            FROM category c
            LEFT JOIN products p ON c.category_id = p.category_id
            GROUP BY c.category_id, c.category
            ORDER BY c.category;
        `;

        const result = await req.db.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No categories found' });
        }

        return res.status(200).json({
            success: true,
            categories: result.rows,
        });
    } catch (error) {
        console.error("Database query error:", error);
        return res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

module.exports = router;
