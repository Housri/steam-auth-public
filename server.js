const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Debug environment variables
console.log('🔧 Environment Check:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'MISSING');
console.log('STEAM_API_KEY:', process.env.STEAM_API_KEY ? 'SET' : 'MISSING');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? 'SET' : 'MISSING');
console.log('BASE_URL:', process.env.BASE_URL || 'NOT SET');
console.log('NODE_ENV:', process.env.NODE_ENV || 'NOT SET');

// Database connection
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('✅ Database pool created');
} catch (error) {
  console.error('❌ Database pool creation failed:', error);
}

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Steam Strategy
passport.use(new SteamStrategy({
    returnURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/steam/return`,
    realm: process.env.BASE_URL || 'http://localhost:3000',
    apiKey: process.env.STEAM_API_KEY
  },
  async (identifier, profile, done) => {
    try {
      console.log('🔐 Steam authentication started');
      
      if (!pool) {
        throw new Error('Database connection not available');
      }

      // Simple user handling - just return profile
      const user = {
        steamId: profile.id,
        username: profile.displayName,
        profileUrl: profile._json.profileurl,
        avatar: profile._json.avatarfull
      };
      
      console.log('✅ Authentication successful for:', user.username);
      return done(null, user);
    } catch (error) {
      console.error('❌ Authentication error:', error);
      return done(error);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// View engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Routes
app.get('/', (req, res) => {
  res.render('index', { user: req.user });
});

app.get('/auth/steam',
  passport.authenticate('steam', { failureRedirect: '/' })
);

app.get('/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/profile');
  }
);

app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('profile', { user: req.user });
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) { 
      console.error('❌ Logout error:', err);
    }
    res.redirect('/');
  });
});

app.get('/error', (req, res) => {
  res.render('error', { 
    message: 'Something went wrong!'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
