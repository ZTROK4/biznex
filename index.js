const express = require('express');
const passport = require('passport');
const session = require('express-session');
const dotenv = require('dotenv');
const pool = require('./master_db'); // PostgreSQL connection
const authRoutes = require('./auth');
const signupRoutes = require('./signup_client');
dotenv.config();
const app = express();
const PORT = 5000;

// Middleware for express-session
app.use(session({
    secret: process.env.SESSION_SECRET || 'cats',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.json());
app.use('/signup-client', signupRoutes);
// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Google OAuth Strategy - Dynamic Callback
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const createGoogleStrategy = (userType) => {
    return new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `https://biznex.onrender.com/auth/google/${userType}/callback`,
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails[0].value;
            let userQuery = '';

            switch (userType) {
                case 'client':
                    userQuery = 'SELECT * FROM clients WHERE email = $1';
                    break;
                case 'job_user':
                    userQuery = 'SELECT * FROM job_user WHERE email = $1';
                    break;
                case 'market_user':
                    userQuery = 'SELECT * FROM market_user WHERE email = $1';
                    break;
                default:
                    return done(null, false, { message: 'Invalid user type' });
            }

            const user = await pool.query(userQuery, [email]);

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

// Register strategies
passport.use('google-client', createGoogleStrategy('client'));
passport.use('google-job_user', createGoogleStrategy('job_user'));
passport.use('google-market_user', createGoogleStrategy('market_user'));

// Passport session handling
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => done(null, obj));

// Use the auth router
app.use('/auth', authRoutes);

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on https://biznex.onrender.com`);
});