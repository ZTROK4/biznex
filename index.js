const express = require('express');
const passport = require('passport');
const cors = require('cors');
const session = require('express-session');
const dotenv = require('dotenv');
const pool = require('./master_db'); // PostgreSQL connection
const authRoutes = require('./auth');
const signupRoutes = require('./signup_client');
const signupJobuser = require('./signup_job_user');
const signupMarketuser = require('./signup_market_user');
const loginClient = require('./login_client');
const loginJobuser = require('./login_job_user');
const loginMarketuser = require('./login_market_user');
const jobClient = require('./job_list');
const dashBoard = require('./dashmain');
const financeV = require('/finance');
const invenV = require('/inventory');


dotenv.config();
const app = express();
const PORT = 5000;



const corsOptions = {
    origin: 'http://localhost:5000',
    credentials: true, 
  };
  
app.use(cors(corsOptions)); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'cats',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true, 
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    }
}));


app.use(express.json());
app.use('/auth', authRoutes);
app.use('/signup/client', signupRoutes);
app.use('/signup/job-user', signupJobuser);
app.use('/signup/market-user', signupMarketuser);
app.use('/login/client', loginClient);
app.use('/login/job-user', loginJobuser);
app.use('/login/market-user', loginMarketuser);
app.use('/job/client',jobClient);
app.use('/dashboard',dashBoard);
app.use('/finance',financeV);
app.use('/inventory',invenV);

app.use(passport.initialize());
app.use(passport.session());


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


passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser(async (user, done) => {
    try {
        done(null, user); 
    } catch (err) {
        done(err, null);
    }
});



app.listen(PORT, () => {
    console.log(`✅ Server running on https://biznex.onrender.com`);
});
