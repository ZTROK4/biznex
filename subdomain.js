const express = require("express");
const cors = require("cors");
const masterPool = require("./master_db"); // PostgreSQL connection
const { Pool } = require('pg');
const jwt = require('jsonwebtoken'); // Make sure this is at the top
const bcrypt = require('bcrypt'); // Also required

const router = express.Router();
router.use(cors());




router.use(async (req, res, next) => {
    try {
        let subdomain = req.query.subdomain; 
        
        if (!subdomain || subdomain.trim() === "" || subdomain === "www") {
            return res.status(400).json({ error: "Invalid or missing subdomain." });
        }

        console.log("🔹 Extracted subdomain from query:", subdomain);


        const clientQuery = "SELECT client_id FROM clients WHERE subdomain = $1";
        const clientResult = await masterPool.query(clientQuery, [subdomain]);

        if (clientResult.rows.length === 0) {
            console.warn(`❌ No client found for subdomain: ${subdomain}`);
            return res.status(404).json({ error: "Store not found." });
        }

        const clientId = clientResult.rows[0].client_id;


        const dbQuery = "SELECT db_name FROM clients WHERE client_id = $1";
        const dbResult = await masterPool.query(dbQuery, [clientId]);

        if (dbResult.rows.length === 0) {
            console.warn(`❌ No database found for client ID: ${clientId}`);
            return res.status(404).json({ error: "Database not found." });
        }

        const clientDbName = dbResult.rows[0].db_name;

      
        req.db = new Pool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: clientDbName,
        });

        req.clientId = clientId; 
        req.dbname = clientDbName; 

        next();
    } catch (error) {
        console.error("❌ Database connection error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

router.use(async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(400).json({ error: 'No token provided. Please log in first.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        let user_id = decoded.id;
   
        user_id=parseInt(user_id);
        const result = await req.db.query('SELECT user_id FROM users WHERE user_id = $1', [user_id]);

        if (result.rows.length === 0) {

            return res.status(401).json({ error: 'Invalid client ID. Unauthorized access.' });
        }

        req.user_id = user_id;

        next();
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
});




router.post('/order/checkout', async (req, res) => {
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
        const cartResult = await req.db.query(
            `INSERT INTO orders (total_price, status) VALUES ($1, $2) RETURNING order_id, created_at`,
            [totalPrice, status]
        );
        const cartId = cartResult.rows[0].cart_id;

        // 2. Loop through items
        for (const item of items) {
            const { product_id, quantity, unit_price } = item;

            // Check product stock
            const stockResult = await req.db.query(
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
            await req.db.query(
                `INSERT INTO order_item (order_id, product_id, quantity, unit_price)
                 VALUES ($1, $2, $3, $4)`,
                [cartId, product_id, quantity, unit_price]
            );

            // Decrement stock
            await req.db.query(
                `UPDATE products SET quantity = quantity - $1 WHERE id = $2`,
                [quantity, product_id]
            );
        }

        // 3. Create bill
        const billResult = await req.db.query(
            `INSERT INTO web_bills (order_id, total_amount, payment_status, payment_method)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [cartId, totalPrice, payment_status, payment_method]
        );

        await req.db.query(
            `INSERT INTO man_incomes (type, description, amount, income_date)
             VALUES ($1, $2, $3, $4)`,
            [
                'Sale',
                `Bill for order_id ${cartId}`,
                totalPrice,
                new Date() 
            ]
        );
        await req.db.query('COMMIT');

        res.status(201).json({
            message: 'Checkout successful',
            cart: {
                order_id: cartId,
                status,
                total_price: totalPrice,
                created_at: cartResult.rows[0].created_at,
                items,
                web_bill: billResult.rows[0]
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

router.get("/products", async (req, res) => {
    try {
        const query = `
        SELECT * FROM products 
        WHERE status = 'Active' 
          AND type IN ('Online', 'Hybrid')
          AND deleted = false;
      `;
      
      
      const { rows } = await req.db.query(query);
  
      if (rows.length === 0) {
        return res.status(404).json({ error: "Store data not found." });
      }
  
      res.json(rows);
  
    } catch (error) {
      console.error("❌ Database Error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });
  
  

module.exports = router;

