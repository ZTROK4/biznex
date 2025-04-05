const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const router = express.Router();
const passport = require('passport');
const masterPool = require('./master_db');
router.use(express.json());

router.use(session({
  secret: 'asdfghjkl',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } 
}));
router.use(passport.initialize());
router.use(passport.session());

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

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.login(user, (err) => {
      if (err) return next(err);
      req.session.userId = user.market_user_id || user.id;
      req.session.email = user.email;
      req.session.dbname = null;
      req.session.userType = 'market_user';
      return res.status(200).json({ message: 'Market user login successful' });
    });

  } catch (error) {
    console.error('Market user login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
}

router.get('/market-dashboard', isAuthenticated, (req, res) => {
  res.json({ message: `Welcome market user: ${req.user.email}` });
});

module.exports = router;