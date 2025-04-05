const express = require("express");
const cors = require("cors");
const masterPool = require("./master_db"); // PostgreSQL connection
const { Pool } = require('pg');



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


router.get("/products", async (req, res) => {
    try {
      const query = "SELECT * FROM products WHERE status = 'active';";
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

