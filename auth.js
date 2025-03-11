const express = require('express');
const passport = require('passport');
const router = express.Router();

// Google Auth Routes
router.get('/google/client', passport.authenticate('google-client', { scope: ['profile', 'email'] }));
router.get('/google/job_user', passport.authenticate('google-job_user', { scope: ['profile', 'email'] }));
router.get('/google/market_user', passport.authenticate('google-market_user', { scope: ['profile', 'email'] }));

// Google Callback Routes
router.get('/google/client/callback',
    passport.authenticate('google-client', { failureRedirect: '/access-denied' }),
    (req, res) => res.redirect('/dashboard')
);

router.get('/google/job_user/callback',
    passport.authenticate('google-job_user', { failureRedirect: '/access-denied' }),
    (req, res) => res.redirect('/vendor/dashboard')
);

router.get('/google/market_user/callback',
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

// Logout Route
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

module.exports = router; // ✅ Export router properly
