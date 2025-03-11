const express = require('express');
const session = require("express-session");
const passport = require('passport');
const authh=require('./auth'); // This should configure your Passport strategies

const app = express();
const PORT = 3000;

// Middleware for express-session
app.use(session({
    secret: 'your-secure-random-string', // Use a strong secret
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true on HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
}));
app.use('/auth', authh);
// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware to check if the user is logged in
function isLoggedIn(req, res, next) {
    req.user ? next() : res.sendStatus(401);
}

// Home route with an authentication link
app.get('/', (req, res) => {
    res.send('<a href="/auth/google/job_user">Authenticate with Google</a>');
});

// Example protected route using isLoggedIn middleware
app.get('/profile', isLoggedIn, (req, res) => {
    res.send(`Hello ${req.user.email}, welcome to your profile page!`);
});

// Logout route
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.session.destroy(() => {
            res.clearCookie('connect.sid'); // Clear the default session cookie
            res.redirect('/');
        });
    });
});

// Start the server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
