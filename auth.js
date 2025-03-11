const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const dotenv = require('dotenv');
const pool = require('./master_db'); // PostgreSQL connection
const session = require('express-session');
const router = express.Router();

dotenv.config();
const app = express();
const PORT = 5000;

// Middleware for express-session
app.use(session({
  secret: 'cats',  // Use a secure, random string
  resave: false,              // Avoid resaving unchanged sessions
  saveUninitialized: false,   // Don’t save uninitialized sessions
  cookie: {
      secure: false,          // Set to true if using HTTPS
      maxAge: 24 * 60 * 60 * 1000 // Session lasts 1 day
  }
}));
// Separate session instances for each user type
const clientSession = session({
    secret: 'client_secret',
    resave: false,
    saveUninitialized: false,
    name: 'client.sid',
});

const jobUserSession = session({
    secret: 'job_user_secret',
    resave: false,
    saveUninitialized: false,
    name: 'jobuser.sid',
});

const marketUserSession = session({
    secret: 'market_user_secret',
    resave: false,
    saveUninitialized: false,
    name: 'marketuser.sid',
});

// Apply sessions dynamically based on user type
app.use('/auth/google/client', clientSession);
app.use('/auth/google/job_user', jobUserSession);
app.use('/auth/google/market_user', marketUserSession);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Strategy - Dynamic Callback
const createGoogleStrategy = (userType) => {
    return new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `http://localhost:5000/auth/google/${userType}/callback`,
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails[0].value;

            let user;
            if (userType === 'client') {
                user = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
            } else if (userType === 'job_user') {
                user = await pool.query('SELECT * FROM job_user WHERE email = $1', [email]);
            } else if (userType === 'market_user') {
                user = await pool.query('SELECT * FROM market_user WHERE email = $1', [email]);
            }

            if (user.rows.length > 0) {
                return done(null, { 
                    id: user.rows[0].client_id || user.rows[0].id,
                    email: user.rows[0].email,
                    dbname: userType === 'client' ? user.rows[0].db_name : null,
                    userType
                });
            } else {
                return done(null, false, { message: 'User not found' });
            }
        } catch (err) {
            return done(err);
        }
    });
};

// Register strategies for each user type
passport.use('google-client', createGoogleStrategy('client'));
passport.use('google-job_user', createGoogleStrategy('job_user'));
passport.use('google-market_user', createGoogleStrategy('market_user'));

// Passport session handling
passport.serializeUser((user, done) => {
    done(null, {
        id: user.id,
        dbname: user.dbname,
        email: user.email,
        userType: user.userType
    });
});

passport.deserializeUser((obj, done) => done(null, obj));

// Google Auth Routes
router.get('/auth/google/client', passport.authenticate('google-client', { scope: ['profile', 'email'] }));
router.get('/auth/google/job_user', passport.authenticate('google-job_user', { scope: ['profile', 'email'] }));
router.get('/auth/google/market_user', passport.authenticate('google-market_user', { scope: ['profile', 'email'] }));

// Google Callback Routes
router.get('/auth/google/client/callback',
    passport.authenticate('google-client', { failureRedirect: '/access-denied' }),
    (req, res) => res.redirect('/dashboard')
);

router.get('/auth/google/job_user/callback',
    passport.authenticate('google-job_user', { failureRedirect: '/access-denied' }),
    (req, res) => res.redirect('/vendor/dashboard')
);

router.get('/auth/google/market_user/callback',
    passport.authenticate('google-market_user', { failureRedirect: '/access-denied' }),
    (req, res) => res.redirect('/customer/dashboard')
);

// Check session data
router.get('/session-data', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            id: req.user.id,
            email: req.user.email,
            userType: req.user.userType,
            dbname: req.user.dbname
        });
    } else {
        res.json({ message: "Not authenticated" });
    }
});

// Improved logout to handle different session cookies
router.get('/logout', (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    req.logout((err) => {
        if (err) return next(err);

        const sessionName = {
            client: 'client.sid',
            job_user: 'jobuser.sid',
            market_user: 'marketuser.sid'
        }[req.user?.userType] || 'connect.sid';

        req.session.destroy((err) => {
            if (err) return next(err);
            res.clearCookie(sessionName);
            res.redirect('/');
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
