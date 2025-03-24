const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const router = express.Router();
const passport = require('passport');
const masterPool = require('./master_db');
router.use(express.json());

// Session middleware
router.use(session({
  secret: 'asdfghjkl',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' } 
}));

router.use(passport.initialize());
router.use(passport.session());
router.use(cors());
// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user.id); 
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await masterPool.query('SELECT * FROM job_user WHERE id = $1', [id]);
    if (result.rows.length === 0) return done(null, false);
    done(null, result.rows[0]);
  } catch (error) {
    done(error);
  }
});

// Job user login route
router.post("/login-job-user", async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await masterPool.query('SELECT * FROM job_user WHERE email = $1', [email]);

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
      if (err) {
        console.error("Session error:", err);
        return res.status(500).json({ error: "Session creation failed" });
      }
      req.session.userId = user.job_user_id || user.id;
      req.session.email = user.email;
      req.session.dbname = null;
      req.session.userType = 'job_user';
      return res.status(200).json({ message: 'Login successful', user: { id: user.id, email: user.email } });
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Auth check middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
}


router.get('/job-dashboard', isAuthenticated, (req, res) => {
  res.json({ message: `Welcome Job User ${req.user.email}` });
});

module.exports = router;