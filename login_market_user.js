const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const router = express.Router();
const passport = require('passport');
const masterPool = require('./master_db');
const cors = require('cors');
router.use(express.json());

// Session middleware
router.use(session({
  secret: 'asdfghjkl',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));
router.use(cors());
router.use(passport.initialize());
router.use(passport.session());

// Login route for market users
router.post("/login-market-user", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await masterPool.query('SELECT * FROM market_user WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Compare hashed password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Start session
    req.login(user, (err) => {
      if (err) return next(err);
      return res.status(200).json({ message: 'Market user login successful' });
    });

  } catch (error) {
    console.error('Market user login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Auth check middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
}

// Protected route for market users
router.get('/market-dashboard', isAuthenticated, (req, res) => {
  res.json({ message: `Welcome market user: ${req.user.email}` });
});

module.exports = router;