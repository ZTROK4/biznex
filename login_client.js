const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const masterPool = require('./master_db');
router.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

router.post("/login-client", async (req, res) => {
  console.log("Login client request received:", req.body); 
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await masterPool.query('SELECT * FROM clients WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({
      id: user.client_id || user.id,
      email: user.email,
      dbname: user.db_name,
      userType: 'client'
    }, JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({
      message: 'Login successful',
      client: user.client_name,
      token
    });
  } catch (error) { 
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
