// Import required packages
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();
const router = express.Router();
const bcrypt = require('bcrypt');
const nodemailer = require("nodemailer");
const twilio = require('twilio');
const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const crypto = require("crypto");
const port = 5000;

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

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

//  1. Send Email OTP
router.post("/send-email-otp", async (req, res) => {
  const { email} = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  const result=await masterPool.query('SELECT * FROM clients WHERE email = $1', [email]);
  if (result.rows.length === 0){
    try {
        const emailOtp = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
        await masterPool.query('DELETE FROM client_verifications WHERE email = $1', [email]);
        
        await masterPool.query(
          `INSERT INTO client_verifications (email, email_otp, expires_at)
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
        console.log(` Sent OTP to ${email}: ${emailOtp}`);
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

router.post("/send-phone-otp", async (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) return res.status(400).json({ error: "Email and phone are required" });

  try {
    const userCheck = await masterPool.query(
      `SELECT * FROM client_verifications WHERE email = $1 ;`,
      [email]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const phoneOtp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 

    await masterPool.query(
      `UPDATE client_verifications SET phone_otp = $1, expires_at = $2, phone= $3 ,is_phone_verified = FALSE 
       WHERE email = $4 ;`,
      [phoneOtp, expiresAt, phone, email]
    );

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
router.post("/verify-email-otp", async (req, res) => {
  const { email, emailOtp } = req.body;
  if (!email || !emailOtp) return res.status(400).json({ error: "Email and OTP are required." });

  try {
    const result = await masterPool.query(`SELECT * FROM client_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { email_otp, expires_at, is_email_verified } = result.rows[0];

    if (is_email_verified) return res.status(400).json({ error: "Email already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (email_otp !== emailOtp) return res.status(400).json({ error: "Invalid email OTP." });

    await masterPool.query(`UPDATE client_verifications SET is_email_verified = TRUE WHERE email = $1;`, [email]);

    res.json({ message: "Email verified successfully." });
  } catch (error) {
    console.error("Error verifying email OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//  4. Verify Phone OTP
router.post("/verify-phone-otp", async (req, res) => {
  const { email, phoneOtp } = req.body;
  if (!email || !phoneOtp) return res.status(400).json({ error: "Email and phone OTP are required." });

  try {
    const result = await masterPool.query(`SELECT * FROM client_verifications WHERE email = $1;`, [email]);

    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

    const { phone_otp, expires_at, is_phone_verified, is_email_verified } = result.rows[0];

    if (is_phone_verified) return res.status(400).json({ error: "Phone already verified." });
    if (new Date() > new Date(expires_at)) return res.status(400).json({ error: "OTP expired." });
    if (phone_otp !== phoneOtp) return res.status(400).json({ error: "Invalid phone OTP." });

    await masterPool.query(`UPDATE client_verifications SET is_phone_verified = TRUE WHERE email = $1;`, [email]);


    res.json({ message: "Phone verified successfully." });
  } catch (error) {
    console.error("Error verifying phone OTP:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function hashPassword(password) {
    const saltRounds = 10; // Higher is more secure but slower
    try {
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      console.log("Hashed Password:", hashedPassword);
      return hashedPassword;
    } catch (err) {
      console.error("Error hashing password:", err);
    }
  }

router.post('/create-client', async (req, res) => {
  const { username,ownername, address, email,business_category,phone, password } = req.body;
  if (!username || !email || !password ||!ownername||!address||!business_category||!phone) {
    return res.status(400).json({ error: 'Missing required fields' , message : {username,ownername,address, email, phone ,password} });
  }

  const result=await masterPool.query('SELECT * FROM clients WHERE email = $1', [email]);
  if (result.rows.length === 0){
      try {

        const result = await masterPool.query(`SELECT * FROM client_verifications WHERE email = $1;`, [email]);

        if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email." });

        const { phone_otp, expires_at, is_phone_verified, is_email_verified } = result.rows[0];
        
        const hpassword= await hashPassword(password);
        
        if(is_email_verified && is_phone_verified){
            const userResult = await masterPool.query(
                'INSERT INTO clients (client_name,owner_name, email,address,business_category,status, password_hash,ph_no) VALUES ($1, $2, $3,$4,$5,$6,$7,$8) RETURNING client_id;',
                [username,ownername, email, address, business_category,'active',hpassword,phone]
              );
          
              const userId = userResult.rows[0].client_id;

              const dbName = `user_db_${userId}`;
          
              const dbUpdateResult = await masterPool.query(
              'UPDATE clients SET db_name = $1 WHERE client_id = $2 RETURNING *;',
              [dbName, userId]
              );
          
              if (userResult.rowCount === 0) {
                console.log('No client found with that ID.');
              } else {
                console.log('Updated client:', userResult.rows[0]);
              }
              await masterPool.query(`CREATE DATABASE ${dbName};`);
          
              const userPool = new Pool({
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                host: process.env.DB_HOST,
                port: process.env.DB_PORT,
                database: dbName,
              });
          
              // Create enums, tables, and triggers
              await userPool.query(`
                CREATE TYPE cart_status AS ENUM ('pending', 'processing', 'completed', 'cancelled');
                CREATE TYPE cart_log_status AS ENUM ('Created', 'processing', 'shipped', 'delivered', 'cancelled');
                CREATE TYPE bill_status AS ENUM ('paid', 'pending', 'failed');
                CREATE TYPE bill_log_status AS ENUM ('generated', 'paid', 'refunded');
                CREATE TYPE web_bill_status AS ENUM ('paid', 'pending', 'failed');
                CREATE TYPE web_bill_log_status AS ENUM ('generated', 'paid', 'refunded');
                CREATE TYPE order_status AS ENUM ('pending', 'processing', 'completed', 'cancelled');
                CREATE TYPE order_log_status AS ENUM ('created', 'processing', 'shipped', 'cancelled', 'delivered');
                CREATE TYPE payment_status AS ENUM ('Pending', 'Paid', 'Overdue');
                CREATE TYPE payment_method AS ENUM ('Cash', 'Credit Card', 'Bank Transfer', 'Other');
                CREATE TYPE product_status AS ENUM ('active', 'inactive');
                CREATE TYPE salary_status AS ENUM ('pending', 'paid', 'failed');
                CREATE TYPE payment_method_salary AS ENUM ('bank_transfer', 'cash', 'cheque', 'upi');

               CREATE TABLE products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                quantity INT NOT NULL CHECK (quantity >= 0),
                barcode VARCHAR(50) UNIQUE NOT NULL,
                category VARCHAR(100) NOT NULL,
                status VARCHAR(20) DEFAULT 'active',
                bestseller BOOLEAN DEFAULT FALSE,
                imageUrl TEXT,
                type VARCHAR(50)
              );


                CREATE TABLE category (
                    category_id SERIAL PRIMARY KEY,
                    category VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

          

                CREATE TABLE employees (
                    id SERIAL PRIMARY KEY,
                    first_name VARCHAR(100) NOT NULL,
                    last_name VARCHAR(100) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    phone VARCHAR(20) UNIQUE NOT NULL,
                    position VARCHAR(100) NOT NULL,
                    salary DECIMAL(10,2) NOT NULL CHECK (salary >= 0),
                    bank_name VARCHAR(255) NOT NULL,
                    bank_account_number VARCHAR(50) UNIQUE NOT NULL,
                    ifsc_code VARCHAR(11) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE salaries (
                    id SERIAL PRIMARY KEY,
                    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                    salary_amount DECIMAL(10,2) NOT NULL CHECK (salary_amount >= 0),
                    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    salary_month DATE NOT NULL,
                    payment_method payment_method_salary NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE cart (
                  cart_id SERIAL PRIMARY KEY,
                  total_price DECIMAL(10, 2) NOT NULL,
                  status cart_status,
                  created_at TIMESTAMP DEFAULT NOW()
                );
          
                CREATE TABLE cart_logs (
                  log_id SERIAL PRIMARY KEY,
                  cart_id INT NOT NULL,
                  status cart_log_status,
                  updated_at TIMESTAMP DEFAULT NOW(),
                  CONSTRAINT fk_cart_log FOREIGN KEY (cart_id) REFERENCES cart(cart_id)
                );

                CREATE TABLE cart_item (
                  cart_item_id SERIAL PRIMARY KEY,
                  cart_id INT NOT NULL,
                  product_id INT NOT NULL,
                  quantity INT NOT NULL CHECK (quantity > 0),
                  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0), -- Store price at the time of purchase
                  CONSTRAINT fk_cart FOREIGN KEY (cart_id) REFERENCES cart(cart_id) ON DELETE CASCADE,
                  CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                );
          
                CREATE TABLE bills (
                  bill_id SERIAL PRIMARY KEY,
                  cart_id INT NOT NULL,
                  total_amount DECIMAL(10, 2) NOT NULL,
                  payment_status bill_status,
                  payment_method VARCHAR(50) CHECK (payment_method IN ('card', 'UPI', 'cash')),
                  generated_at TIMESTAMP DEFAULT NOW(),
                  CONSTRAINT fk_cart_bill FOREIGN KEY (cart_id) REFERENCES cart(cart_id)
                );
          
                CREATE TABLE bill_logs (
                  bill_log_id SERIAL PRIMARY KEY,
                  bill_id INT NOT NULL,
                  status bill_log_status,
                  updated_at TIMESTAMP DEFAULT NOW(),
                  CONSTRAINT fk_bill FOREIGN KEY (bill_id) REFERENCES bills(bill_id)
                );
          
                CREATE TABLE web_bills (
                  web_bill_id SERIAL PRIMARY KEY,
                  order_id INT NOT NULL,
                  total_amount DECIMAL(10, 2) NOT NULL,
                  payment_status web_bill_status,
                  payment_method VARCHAR(50) CHECK (payment_method IN ('card', 'UPI', 'cash')),
                  generated_at TIMESTAMP DEFAULT NOW(),
                  CONSTRAINT fk_cart_web_bill FOREIGN KEY (cart_id) REFERENCES cart(cart_id)
                );

          
                CREATE TABLE web_bill_logs (
                  web_log_id SERIAL PRIMARY KEY,
                  bill_id INT NOT NULL,
                  status web_bill_log_status,
                  updated_at TIMESTAMP DEFAULT NOW(),
                  CONSTRAINT fk_web_bill FOREIGN KEY (bill_id) REFERENCES web_bills(web_bill_id)
                );

          
                CREATE TABLE orders (
                  order_id SERIAL PRIMARY KEY,
                  total_price DECIMAL(10, 2) NOT NULL,
                  status order_status,
                  created_at TIMESTAMP DEFAULT NOW()
                );
          
                CREATE TABLE order_logs (
                  log_id SERIAL PRIMARY KEY,
                  order_id INT NOT NULL,
                  status order_log_status,
                  updated_at TIMESTAMP DEFAULT NOW(),
                  CONSTRAINT fk_order_log FOREIGN KEY (order_id) REFERENCES orders(order_id)
                );
                
                CREATE TABLE order_item (
                    order_item_id SERIAL PRIMARY KEY,
                    order_id INT NOT NULL,
                    product_id INT NOT NULL,
                    quantity INT NOT NULL CHECK (quantity > 0),
                    unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0), 
                    CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
                    CONSTRAINT fk_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                );


                CREATE TABLE documents (
                  document_id SERIAL PRIMARY KEY,
                  file_url TEXT NOT NULL,         
                  description TEXT,                
                  created_at TIMESTAMP DEFAULT NOW()  
                );

                CREATE TABLE man_expenses (
                  id SERIAL PRIMARY KEY,
                  type VARCHAR(100) NOT NULL,
                  description TEXT,
                  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
                  payment_method VARCHAR(50) CHECK (payment_method IN ('Cash', 'Card', 'UPI', 'Bank Transfer', 'Other')),
                  expense_date DATE NOT NULL,
                  created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE man_incomes (
                  id SERIAL PRIMARY KEY,
                  type VARCHAR(100) NOT NULL,
                  description TEXT,
                  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
                  payment_method VARCHAR(50) CHECK (payment_method IN ('Cash', 'Card', 'UPI', 'Bank Transfer', 'Other')),
                  income_date DATE NOT NULL,
                  created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE accounts_payable (
                  id SERIAL PRIMARY KEY,
                  account_name VARCHAR(255) NOT NULL,
                  amount DECIMAL(10,2) NOT NULL,
                  payment_date DATE NOT NULL,
                  payment_method payment_method NOT NULL,
                  status payment_status DEFAULT 'Pending',
                  created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE accounts_receivable (
                  id SERIAL PRIMARY KEY,
                  account_name VARCHAR(255) NOT NULL,
                  amount DECIMAL(10,2) NOT NULL,
                  due_date DATE NOT NULL,
                  status payment_status DEFAULT 'Pending',
                  created_at TIMESTAMP DEFAULT NOW()
                );



                CREATE TABLE accounts_payable_log (
                  log_id SERIAL PRIMARY KEY,
                  payable_id INT NOT NULL,
                  account_name VARCHAR(255) NOT NULL,
                  amount DECIMAL(10,2) NOT NULL,
                  payment_date DATE NOT NULL,
                  payment_method payment_method NOT NULL,
                  status payment_status NOT NULL,
                  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  operation_type VARCHAR(10) CHECK (operation_type IN ('INSERT', 'UPDATE', 'DELETE'))
                );

                CREATE TABLE accounts_receivable_log (
                  log_id SERIAL PRIMARY KEY,
                  receivable_id INT NOT NULL,
                  account_name VARCHAR(255) NOT NULL,
                  amount DECIMAL(10,2) NOT NULL,
                  due_date DATE NOT NULL,
                  status payment_status NOT NULL,
                  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  operation_type VARCHAR(10) CHECK (operation_type IN ('INSERT', 'UPDATE', 'DELETE'))
                );


                -- Trigger functions for logs
          
                CREATE OR REPLACE FUNCTION log_cart_changes() RETURNS TRIGGER AS $$
                BEGIN
                  INSERT INTO cart_logs(cart_id, status) VALUES (NEW.cart_id, NEW.status);
                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
          
                CREATE TRIGGER cart_log_trigger
                AFTER INSERT OR UPDATE ON cart
                FOR EACH ROW EXECUTE FUNCTION log_cart_changes();
          
                CREATE OR REPLACE FUNCTION log_bill_changes() RETURNS TRIGGER AS $$
                BEGIN
                  INSERT INTO bill_logs(bill_id, status) VALUES (NEW.bill_id, NEW.payment_status);
                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
          
                CREATE TRIGGER bill_log_trigger
                AFTER INSERT OR UPDATE ON bills
                FOR EACH ROW EXECUTE FUNCTION log_bill_changes();
          
                CREATE OR REPLACE FUNCTION log_web_bill_changes() RETURNS TRIGGER AS $$
                BEGIN
                  INSERT INTO web_bill_logs(bill_id, status) VALUES (NEW.web_bill_id, NEW.payment_status);
                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
          
                CREATE TRIGGER web_bill_log_trigger
                AFTER INSERT OR UPDATE ON web_bills
                FOR EACH ROW EXECUTE FUNCTION log_web_bill_changes();
          
                CREATE OR REPLACE FUNCTION log_order_changes() RETURNS TRIGGER AS $$
                BEGIN
                  INSERT INTO order_logs(order_id, status) VALUES (NEW.order_id, NEW.status);
                  RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
          
                CREATE TRIGGER order_log_trigger
                AFTER INSERT OR UPDATE ON orders
                FOR EACH ROW EXECUTE FUNCTION log_order_changes();


                CREATE OR REPLACE FUNCTION log_accounts_payable_changes()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        INSERT INTO accounts_payable_log (payable_id, account_name, amount, payment_date, payment_method, status, operation_type)
                        VALUES (OLD.id, OLD.account_name, OLD.amount, OLD.payment_date, OLD.payment_method, OLD.status, 'DELETE');
                    ELSIF TG_OP = 'UPDATE' THEN
                        INSERT INTO accounts_payable_log (payable_id, account_name, amount, payment_date, payment_method, status, operation_type)
                        VALUES (NEW.id, NEW.account_name, NEW.amount, NEW.payment_date, NEW.payment_method, NEW.status, 'UPDATE');
                    ELSE
                        INSERT INTO accounts_payable_log (payable_id, account_name, amount, payment_date, payment_method, status, operation_type)
                        VALUES (NEW.id, NEW.account_name, NEW.amount, NEW.payment_date, NEW.payment_method, NEW.status, 'INSERT');
                    END IF;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trigger_accounts_payable
                AFTER INSERT OR UPDATE OR DELETE ON accounts_payable
                FOR EACH ROW EXECUTE FUNCTION log_accounts_payable_changes();


                CREATE OR REPLACE FUNCTION log_accounts_receivable_changes()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        INSERT INTO accounts_receivable_log (receivable_id, account_name, amount, due_date, status, operation_type)
                        VALUES (OLD.id, OLD.account_name, OLD.amount, OLD.due_date, OLD.status, 'DELETE');
                    ELSIF TG_OP = 'UPDATE' THEN
                        INSERT INTO accounts_receivable_log (receivable_id, account_name, amount, due_date, status, operation_type)
                        VALUES (NEW.id, NEW.account_name, NEW.amount, NEW.due_date, NEW.status, 'UPDATE');
                    ELSE
                        INSERT INTO accounts_receivable_log (receivable_id, account_name, amount, due_date, status, operation_type)
                        VALUES (NEW.id, NEW.account_name, NEW.amount, NEW.due_date, NEW.status, 'INSERT');
                    END IF;
                    RETURN NULL;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trigger_accounts_receivable
                AFTER INSERT OR UPDATE OR DELETE ON accounts_receivable
                FOR EACH ROW EXECUTE FUNCTION log_accounts_receivable_changes();


              `);
          
              await userPool.end();
          
              res.status(201).json({ message: 'User created and database initialized', dbName });
              
              }
              else
              {
                
                  console.error('Email or phone not verified.');
                  return res.status(400).json({ error: 'Email or phone not verified.' });
              
                
              }
            } 
            catch (err) {
              console.error('Error creating user or database:', err);
              res.status(500).json({ error: 'Internal server error' });
            }
        }
        else{
          console.error("Email already in use:", error);
          res.status(409).json({ error: "Email already in use" });
        }
});
module.exports = router;
