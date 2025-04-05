const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

router.get('/google/client', passport.authenticate('google-client', { scope: ['profile', 'email'] }));
router.get('/google/job_user', passport.authenticate('google-job_user', { scope: ['profile', 'email'] }));
router.get('/google/market_user', passport.authenticate('google-market_user', { scope: ['profile', 'email'] }));

router.get('/google/client/callback',
  passport.authenticate('google-client', { failureRedirect: '/access-denied', session: false }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({
      id: user.id,
      email: user.email,
      dbname: user.dbname,
      userType: user.userType
    }, JWT_SECRET, { expiresIn: '1h' });

    // 👇 Redirect to React frontend running locally
    res.redirect(`http://localhost:5000/auth/callback/client?token=${token}`);
  }
);


router.get('/google/job_user/callback',
  passport.authenticate('google-job_user', { failureRedirect: '/access-denied' }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({
      id: user.id,
      email: user.email,
      userType: user.userType
    }, JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({
      message: "Authentication successful",
      token
    });
  }
);

router.get('/google/market_user/callback',
  passport.authenticate('google-market_user', { failureRedirect: '/access-denied' }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({
      id: user.id,
      email: user.email,
      userType: user.userType
    }, JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({
      message: "Authentication successful",
      token
    });
  }
);

router.get('/access-denied', (req, res) => res.status(500).json({ message: "Authentication failed" }));

module.exports = router;
