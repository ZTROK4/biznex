const express = require('express');
const passport = require('passport');
const cors = require('cors');
const dotenv = require('dotenv');
const pool = require('./master_db'); // PostgreSQL connection
const jwt = require('jsonwebtoken');
const authRoutes = require('./auth');
const signupRoutes = require('./signup_client');
const signupJobuser = require('./signup_job_user');
const signupMarketuser = require('./signup_market_user');
const loginClient = require('./login_client');
const loginJobUser =require('./login_job_user');
const dashBoard = require('./dashmain');
const financeV = require('./finance');
const invenV = require('./inventory');
const userJob = require('./job_view');
const jobClient = require('./job_list');
const employeeV = require('./employee');
const categoryV=require('./category');
const subDomain=require('./subdomain');
const salaryV =require('./salary');
const s3up =require('./s3upload');
const billV= require('./bill');
const subLog=require('./loginsub');

// JWT Middleware
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// Google OAuth Strategy
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

passport.use('google-client', createGoogleStrategy('client'));
passport.use('google-job_user', createGoogleStrategy('job_user'));
passport.use('google-market_user', createGoogleStrategy('market_user'));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const app = express();
const PORT = process.env.PORT || 5000;

dotenv.config();

const corsOptions = {
  origin: ['http://localhost:5000','https://www.biznex.site','http://*.localhost:5000'],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/signup/client', signupRoutes);
app.use('/signup/job-user', signupJobuser);
app.use('/signup/market-user', signupMarketuser);
app.use('/login/client', loginClient);
app.use('/login/job-user',loginJobUser)
app.use('/dashboard', dashBoard);
app.use('/finance', financeV);
app.use('/inventory', invenV);
app.use('/job/user',userJob);
app.use('/job/client', jobClient);
app.use('/employee',employeeV);
app.use('/category',categoryV);
app.use('/sub',subDomain);
app.use('/salary',salaryV);
app.use('/s3up',s3up);
app.use('/bill',billV);
app.use('/sublogin',subLog);


app.get('/protected', (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1]; 
  if (!token) {
    return res.status(403).json({ message: 'Token is required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    res.status(200).json({ message: 'Protected route accessed', user: decoded });
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
