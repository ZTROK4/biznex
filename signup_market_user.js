// Import required packages
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();
const nodemailer = require("nodemailer");
const router = express.Router();
const bcrypt = require('bcrypt');
const twilio = require('twilio');
const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const crypto = require("crypto");
const app = express();
const port = 5000;
// Master database connection
const masterPool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
  });


router.use(express.json());


const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

//  Generate  OTP
const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// 1. Send Email OTP
router.post("/send-email-otp-market-user", async (req, res) => {
  const { email} = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const result=await masterPool.query('SELECT * FROM market_user WHERE email = $1', [email]);
  if (result.rows.length === 0){
    try {
        const emailOtp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Valid for 10 minutes
  
        await masterPool.query('DELETE FROM market_user_verifications WHERE email = $1', [email]);
    
        
        await masterPool.query(
          `INSERT INTO market_user_verifications (email, email_otp, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) 
           DO UPDATE SET email_otp = $2, expires_at = $3, is_email_verified = FALSE;`,
          [email, emailOtp, expiresAt]
        );
    
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
  }
  else{
    console.error("Email already in use:", error);
    res.status(409).json({ error: "Email already in use" });
  }
  
});

//  2. Send Phone OTP
router.post("/send-phone-otp-market-user", async (req, res) => {
    const { email, phone } = req.body;
    if (!email || !phone) return res.status(400).json({ error: "Email and phone are required" });
    
    try {
        
        const userCheck = await masterPool.query(
        `SELECT * FROM market_user_verifications WHERE email = $1 ;`,
        [email]
        );
    
        if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: "User not found." });
        }
    
        const phoneOtp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 
    
 
        await masterPool.query(
        `UPDATE market_user_verifications SET phone_otp = $1, expires_at = $2, is_phone_verified = FALSE 
            WHERE email = $3 AND phone = $4;`,
        [phoneOtp, expiresAt, email, phone]
        );
    
        // Send OTP using Twilio 
        await client.messages.create({
        body: `Your OTP is: ${phoneOtp}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
        });
    
        console.log(`📲 Sent OTP to ${phone}: ${phoneOtp}`);
        res.json({ message: "Phone OTP sent successfully." });
    } catch (error) {
        console.error("Error sending phone OTP:", error);
        res.status(500).json({ error: "Internal server error" });
    }
    });

//  3. Verify Email OTP
router.post("/verify-email-otp-market-user", async (req, res) => {
  const { email, emailOtp } = req.body;
  if (!email || !emailOtp) return res.status(400).json({ error: "Email and OTP are required." });

  try {
    const result = await masterPool.query(`SELECT * FROM market_user_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { email_otp, expires_at, is_email_verified } = result.rows[0];

    if (is_email_verified) return res.status(400).json({ error: "Email already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (email_otp !== emailOtp) return res.status(400).json({ error: "Invalid email OTP." });


    await masterPool.query(`UPDATE market_user_verifications SET is_email_verified = TRUE WHERE email = $1;`, [email]);

    res.json({ message: "Email verified successfully." });
  } catch (error) {
    console.error("Error verifying email OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//  4. Verify Phone OTP
router.post("/verify-phone-otp-market-user", async (req, res) => {
  const { email, phoneOtp } = req.body;
  if (!email || !phoneOtp) return res.status(400).json({ error: "Email and phone OTP are required." });

  try {
    const result = await masterPool.query(`SELECT * FROM market_user_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { phone_otp, expires_at, is_phone_verified, is_email_verified } = result.rows[0];

    if (is_phone_verified) return res.status(400).json({ error: "Phone already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (phone_otp !== phoneOtp) return res.status(400).json({ error: "Invalid phone OTP." });

    // Mark phone as verified
    await masterPool.query(`UPDATE market_user_verifications SET is_phone_verified = TRUE WHERE email = $1;`, [email]);


    res.json({ message: "Phone verified successfully." });
  } catch (error) {
    console.error("Error verifying phone OTP:", error);
    res.status(500).json({ error: "Internal server error" });
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


router.post('/create-market-user', async (req, res) => {
  const { username,email,address,dob,phone, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {

    const result = await masterPool.query(`SELECT * FROM market_user_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { phone_otp, expires_at, is_phone_verified, is_email_verified } = result.rows[0];
    
    const hpassword= await hashPassword(password);
    
    if(is_email_verified && is_phone_verified){
        const userResult = await masterPool.query(
            'INSERT INTO market_user (job_user_name,address,dob, email, password_hash,phone) VALUES ($1, $2, $3) RETURNING id;',
            [username,address,dob, email, hpassword,phone]
        );
      
        const userId = userResult.rows[0].id;

        res.status(200).json({ message: 'SignUp successfull'});

    }
    else{
        console.error('Email or phone not verified:', err);
    }
    } 
    catch (err) {
        console.error('Error in signup:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
