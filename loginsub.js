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
        const isMatch = await bcrypt.compare(password, user.password_hash);

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

module.exports = router;
