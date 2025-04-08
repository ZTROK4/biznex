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





// API to fetch store data by subdomain
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



router.post("/register", async (req, res) => {
    const subdomain = req.query.subdomain?.trim().toLowerCase();

    if (!subdomain) {
        console.warn("❌ No subdomain provided in query.");
        return res.status(400).json({ error: "Subdomain is required." });
    }

    const { email, password } = req.body;

    try {
        // 1. Check if store exists for subdomain
        const storeCheckQuery = "SELECT * FROM clients WHERE subdomain = $1";
        const storeResult = await masterPool.query(storeCheckQuery, [subdomain]);

        if (storeResult.rows.length === 0) {
            console.warn(`❌ Store not found for subdomain: ${subdomain}`);
            return res.status(404).json({ error: "Store not found." });
        }

        // 2. Check if email already in use
        const emailCheckQuery = "SELECT * FROM customers WHERE email = $1 LIMIT 1";
        const emailCheckResult = await masterPool.query(emailCheckQuery, [email]);

        if (emailCheckResult.rows.length > 0) {
            console.warn(`❌ Email already in use: ${email}`);
            return res.status(409).json({ error: "Email already in use." });
        }

        // 3. Hash the password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 4. Insert into DB
        const insertQuery = "INSERT INTO customers(email, password_hash) VALUES($1, $2) RETURNING id, email";
        const insertResult = await masterPool.query(insertQuery, [email, hashedPassword]);

        res.json({
            name: subdomain,
            email: insertResult.rows[0].email,
            description: `Welcome to ${subdomain}`,
        });

    } catch (error) {
        console.error("❌ Database Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});



router.post("/login", async (req, res) => {
    const subdomain = req.query.subdomain?.trim().toLowerCase();

    if (!subdomain) {
        console.warn("❌ No subdomain provided in query.");
        return res.status(400).json({ error: "Subdomain is required." });
    }

    const { email, password } = req.body;

    try {
        // 1. Check if store exists
        const storeQuery = "SELECT * FROM clients WHERE subdomain = $1";
        const storeResult = await masterPool.query(storeQuery, [subdomain]);

        if (storeResult.rows.length === 0) {
            console.warn(`❌ Store not found for subdomain: ${subdomain}`);
            return res.status(404).json({ error: "Store not found." });
        }

        // 2. Fetch user with email
        const userQuery = "SELECT * FROM customers WHERE email = $1 LIMIT 1";
        const userResult = await masterPool.query(userQuery, [email]);

        if (userResult.rows.length === 0) {
            console.warn(`❌ User not found with email: ${email}`);
            return res.status(401).json({ error: "Invalid credentials." });
        }

        const user = userResult.rows[0];

        // 3. Compare password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            console.warn(`❌ Incorrect password for email: ${email}`);
            return res.status(401).json({ error: "Invalid credentials." });
        }

        // 4. Generate JWT Token
        const tokenPayload = {
            id: user.id,
            email: user.email,
            subdomain: subdomain,
            dbname: storeResult.rows[0].db_name // Optional if used for dynamic DB routing
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
            expiresIn: '7d'
        });

        // 5. Return response with token
        res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                email: user.email,
            }
        });

    } catch (error) {
        console.error("❌ Login Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
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
            `INSERT INTO order (total_price, status) VALUES ($1, $2) RETURNING order_id, created_at`,
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
                order_id_id: cartId,
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

