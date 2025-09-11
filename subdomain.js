const express = require("express");
const cors = require("cors");
const masterPool = require("./master_db"); // PostgreSQL connection
const { Pool } = require('pg');
const jwt = require('jsonwebtoken'); // Make sure this is at the top
const bcrypt = require('bcrypt'); // Also required

const router = express.Router();





router.use(async (req, res, next) => {
    try {
        let lope = req.query.subdomain; 
        let subdomain = lope.split('.')[0];
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
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    
    console.log("Authorization header:", authHeader);
    console.log("Token received:", token);

    if (!token) {
        return res.status(401).json({ error: "No token provided." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.email = decoded.email;
        console.log("Decoded token:", decoded,'idddd',req.user_id);
        
        next();
    } catch (error) {
        console.error("JWT verification error:", error);
        return res.status(401).json({ error: "Invalid or expired token" });
    }
});


router.get("/api/store", async (req, res) => {
    const subdomain = req.query.subdomain?.trim().toLowerCase();

    if (!subdomain) {
        console.warn("❌ No subdomain provided in query.");
        return res.status(400).json({ error: "Subdomain is required." });
    }

    try {
        const query = "SELECT email FROM clients WHERE subdomain = $1";
        const { rows } = await masterPool.query(query, [subdomain]);

        if (rows.length === 0) {
            console.warn(`❌ Store not found for subdomain: ${subdomain}`);
            return res.status(404).json({ error: "Store not found." });
        }

        res.json({
            name: subdomain,
            email: rows[0].email,
            description: `Welcome to ${subdomain}`,
        });

    } catch (error) {
        console.error("❌ Database Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post('/order/checkout', async (req, res) => {
    const client = await req.db.connect();

    try {
        const { status, items, bill } = req.body;
        const userEmail = req.email; // assuming JWT middleware sets req.user

        if (!userEmail) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        // 1. Fetch user_id from email
        const userResult = await client.query(
            `SELECT user_id FROM users WHERE email = $1 LIMIT 1`,
            [userEmail]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user_id = userResult.rows[0].user_id;

        // Validate input
        if (!status || !Array.isArray(items) || items.length === 0 || !bill) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { payment_status, payment_method } = bill;

        // Calculate total price
        const totalPrice = items.reduce((sum, item) => {
            return sum + item.quantity * item.unit_price;
        }, 0);

        await client.query('BEGIN');

        // 2. Create order
        const cartResult = await client.query(
            `INSERT INTO orders (user_id, total_price, status) VALUES ($1, $2, $3) RETURNING order_id, created_at`,
            [user_id, totalPrice, status]
        );
        const cartId = cartResult.rows[0].order_id;

        // 3. Loop through items
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

            // Insert into order_item
            await client.query(
                `INSERT INTO order_item (order_id, product_id, quantity, unit_price)
                 VALUES ($1, $2, $3, $4)`,
                [cartId, product_id, quantity, unit_price]
            );

            // Decrement stock
            await client.query(
                `UPDATE products SET quantity = quantity - $1 WHERE id = $2`,
                [quantity, product_id]
            );
        }

        // 4. Create bill
        const billResult = await client.query(
            `INSERT INTO web_bills (order_id, total_amount, payment_status, payment_method)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [cartId, totalPrice, payment_status, payment_method]
        );

        // 5. Insert into man_incomes
        await client.query(
            `INSERT INTO man_incomes (type, description, amount, income_date)
             VALUES ($1, $2, $3, $4)`,
            [
                'Sale',
                `Bill for order_id ${cartId}`,
                totalPrice,
                new Date()
            ]
        );

        // Commit transaction
        await client.query('COMMIT');

        // Send response
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
        console.error('Checkout error:', error);
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

