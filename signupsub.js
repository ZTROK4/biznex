require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const crypto = require("crypto");
const cors = require("cors");
const masterPool = require("./master_db"); // PostgreSQL connection
const jwt = require('jsonwebtoken'); // Make sure this is at the top
const bcrypt = require('bcrypt'); // Also required
const twilio = require('twilio');
const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const router = express.Router();
router.use(cors());



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
        req.subdomain=subdomain;

        next();
    } catch (error) {
        console.error("❌ Database connection error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

async function hashPassword(password) {
    const saltRounds = 10; 
    try {
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      console.log("Hashed Password:", hashedPassword);
      return hashedPassword;
    } catch (err) {
      console.error("Error hashing password:", err);
    }
  }

// Nodemailer setup (for email OTP)
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// 📧 1. Send Email OTP
router.post("/send-email-otp", async (req, res) => {
  const { email } = req.body;
  console.log("emailIasd:",email);
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await req.db.query('DELETE FROM users_verification WHERE email = $1', [email]);

    await req.db.query(
      `INSERT INTO users_verification (email, email_otp, expires_at, is_email_verified)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (email)
       DO UPDATE SET email_otp = $2, expires_at = $3, is_email_verified = FALSE`,
      [email, otp, expiresAt]
    );

    await transporter.sendMail({
      from: `"Service Platform" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Email OTP",
      text: `Your email OTP is: ${otp}. It is valid for 10 minutes.`,
    });

    res.json({ message: "Email OTP sent successfully." });
  } catch (error) {
    console.error("Error sending email OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// 📲 2. Send Phone OTP
router.post("/send-phone-otp", async (req, res) => {
  const { email, phone } = req.body;
  console.log(email);

  if (!email || !phone) return res.status(400).json({ error: "Email and phone are required" });

  try {
    const result = await req.db.query('SELECT * FROM users_verification WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Email not found." });
    }

    const phoneOtp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await req.db.query(
      `UPDATE users_verification
       SET phone = $1, phone_otp = $2, expires_at = $3, is_phone_verified = FALSE
       WHERE email = $4`,
      [phone, phoneOtp, expiresAt, email]
    );

    await client.messages.create({
      body: `Your OTP is: ${phoneOtp}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });

    res.json({ message: "Phone OTP sent successfully." });
  } catch (error) {
    console.error("Error sending phone OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ✅ 3. Verify Email OTP
router.post("/verify-email-otp", async (req, res) => {
  const { email, emailOtp } = req.body;
  console.log(email);
  if (!email || !emailOtp) return res.status(400).json({ error: "Email and OTP are required." });

  try {
    const result = await req.db.query('SELECT * FROM users_verification WHERE email = $1', [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { email_otp, expires_at, is_email_verified } = result.rows[0];

    if (is_email_verified) return res.status(400).json({ error: "Email already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (email_otp !== emailOtp) return res.status(400).json({ error: "Invalid email OTP." });

    await req.db.query('UPDATE users_verification SET is_email_verified = TRUE WHERE email = $1', [email]);

    res.json({ message: "Email verified successfully." });
  } catch (error) {
    console.error("Error verifying email OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ✅ 4. Verify Phone OTP
router.post("/verify-phone-otp", async (req, res) => {
  const { email, phoneOtp } = req.body;
  console.log(email);

  if (!email || !phoneOtp) return res.status(400).json({ error: "Email and phone OTP are required." });

  try {
    const result = await req.db.query('SELECT * FROM users_verification WHERE email = $1', [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { phone_otp, expires_at, is_phone_verified } = result.rows[0];

    if (is_phone_verified) return res.status(400).json({ error: "Phone already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (phone_otp !== phoneOtp) return res.status(400).json({ error: "Invalid phone OTP." });

    await req.db.query('UPDATE users_verification SET is_phone_verified = TRUE WHERE email = $1', [email]);

    res.json({ message: "Phone verified successfully." });
  } catch (error) {
    console.error("Error verifying phone OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post('/create-user', async (req, res) => {
  const { username, email,phone, password } = req.body;
    console.log(email);

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if the email is in email_verifications
    const verificationResult = await req.db.query(
      `SELECT * FROM users_verification WHERE email = $1;`,
      [email]
    );

    if (verificationResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email." });
    }

    const { phone_otp, expires_at, is_phone_verified, is_email_verified } = verificationResult.rows[0];

    // Check if the email is already registered in users
    const existingUserResult = await req.db.query(
      `SELECT * FROM users WHERE email = $1;`,
      [email]
    );

    if (existingUserResult.rows.length > 0) {
      return res.status(400).json({ error: "Email is already registered." });
    }

    const hpassword = await hashPassword(password);

    if (is_email_verified && is_phone_verified) {
      await req.db.query(
        `INSERT INTO users (full_name, email, password_hash, phone)
         VALUES ($1, $2, $3, $4);`,
        [username, email, hpassword, phone]
      );

      return res.status(200).json({ message: 'Signup successful' });
    } else {
      return res.status(400).json({ error: 'Email or phone not verified' });
    }

  } catch (err) {
    console.error('Error in signup:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post("/login", async (req, res) => {
    const subdomain = req.subdomain;

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
        const userQuery = "SELECT * FROM users WHERE email = $1 LIMIT 1";
        const userResult = await req.db.query(userQuery, [email]);

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
            id: user.user_id,
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
                id: user.user_id,
                email: user.email,
            }
        });

    } catch (error) {
        console.error("❌ Login Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;