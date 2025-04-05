require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const crypto = require("crypto");
const app = express();
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// Nodemailer setup (for email OTP)
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Helper: Generate a 6-digit OTP
const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// 📧 1. Send Email OTP
app.post("/send-email-otp", async (req, res) => {
  const { email} = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const emailOtp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Valid for 10 minutes

    // Insert or update user record
    await pool.query(
      `INSERT INTO client_verifications (email, email_otp, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) 
       DO UPDATE SET email_otp = $2, expires_at = $3, is_email_verified = FALSE;`,
      [email, emailOtp, expiresAt]
    );

    // Send OTP via email
    await transporter.sendMail({
      from: `"Service Platform" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Email OTP",
      text: `Your email OTP is: ${emailOtp}. It is valid for 10 minutes.`,
    });

    res.json({ message: "Email OTP sent successfully." });
  } catch (error) {
    console.error("Error sending email OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 📲 2. Send Phone OTP
app.post("/send-phone-otp", async (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) return res.status(400).json({ error: "Email and phone are required" });

  try {
    const phoneOtp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Valid for 10 minutes

    // Update phone OTP
    await pool.query(
      `UPDATE client_verifications SET phone_otp = $1, expires_at = $2, is_phone_verified = FALSE 
       WHERE email = $3 AND phone = $4;`,
      [phoneOtp, expiresAt, email, phone]
    );

    // Simulate SMS (Replace with actual SMS API like Twilio)
    console.log(`📲 Sent OTP to ${phone}: ${phoneOtp}`);

    res.json({ message: "Phone OTP sent successfully." });
  } catch (error) {
    console.error("Error sending phone OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ 3. Verify Email OTP
app.post("/verify-email-otp", async (req, res) => {
  const { email, emailOtp } = req.body;
  if (!email || !emailOtp) return res.status(400).json({ error: "Email and OTP are required." });

  try {
    const result = await pool.query(`SELECT * FROM client_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { email_otp, expires_at, is_email_verified } = result.rows[0];

    if (is_email_verified) return res.status(400).json({ error: "Email already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (email_otp !== emailOtp) return res.status(400).json({ error: "Invalid email OTP." });

    // Mark email as verified
    await pool.query(`UPDATE client_verifications SET is_email_verified = TRUE WHERE email = $1;`, [email]);

    res.json({ message: "Email verified successfully." });
  } catch (error) {
    console.error("Error verifying email OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ 4. Verify Phone OTP
app.post("/verify-phone-otp", async (req, res) => {
  const { email, phoneOtp } = req.body;
  if (!email || !phoneOtp) return res.status(400).json({ error: "Email and phone OTP are required." });

  try {
    const result = await pool.query(`SELECT * FROM client_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { phone_otp, expires_at, is_phone_verified, is_email_verified } = result.rows[0];

    if (is_phone_verified) return res.status(400).json({ error: "Phone already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (phone_otp !== phoneOtp) return res.status(400).json({ error: "Invalid phone OTP." });

    // Mark phone as verified
    await pool.query(`UPDATE client_verifications SET is_phone_verified = TRUE WHERE email = $1;`, [email]);

    // If both verified, create database
    if (is_email_verified) {
      const dbName = `userdb_${email.replace(/[@.]/g, "_")}`;
      await pool.query(`CREATE DATABASE ${dbName};`);
      return res.json({ message: "Phone verified, user database created.", database: dbName });
    }

    res.json({ message: "Phone verified successfully." });
  } catch (error) {
    console.error("Error verifying phone OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 🚀 Start the Express server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
