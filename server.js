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

// Supabase PostgreSQL connection with better error handling
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { 
      rejectUnauthorized: false 
    } : false
  });
  console.log('✅ Database pool created');
} catch (error) {
  console.error('❌ Database pool creation failed:', error);
}

// Create users table if not exists
async function initializeDatabase() {
  try {
    if (!pool) {
      throw new Error('Database pool not available');
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        steam_id VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) NOT NULL,
        profile_url TEXT,
        avatar_small TEXT,
        avatar_medium TEXT,
        avatar_large TEXT,
        last_login TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

initializeDatabase();

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Steam Strategy with detailed debugging
passport.use(new SteamStrategy({
    returnURL: `${process.env.BASE_URL || 'https://trading.tf'}/auth/steam/return`,
    realm: process.env.BASE_URL || 'https://trading.tf',
    apiKey: process.env.STEAM_API_KEY
  },
  async (identifier, profile, done) => {
    try {
      console.log('🔐 Steam authentication started');
      console.log('📊 Profile data received:', {
        id: profile.id,
        username: profile.displayName,
        profileUrl: profile._json.profileurl,
        avatar: profile._json.avatar
      });

      if (!pool) {
        throw new Error('Database connection not available');
      }

      // Check if user exists
      console.log('🔍 Checking if user exists in database...');
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE steam_id = $1',
        [profile.id]
      );
      
      let user;
      
      if (existingUser.rows.length === 0) {
        console.log('📝 Creating new user...');
        const newUser = await pool.query(
          `INSERT INTO users (steam_id, username, profile_url, avatar_small, avatar_medium, avatar_large) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING *`,
          [
            profile.id,
            profile.displayName,
            profile._json.profileurl,
            profile._json.avatar,
            profile._json.avatarmedium,
            profile._json.avatarfull
          ]
        );
        
        user = {
          id: newUser.rows[0].id,
          steamId: newUser.rows[0].steam_id,
          username: newUser.rows[0].username,
          profileUrl: newUser.rows[0].profile_url,
          avatar: {
            small: newUser.rows[0].avatar_small,
            medium: newUser.rows[0].avatar_medium,
            large: newUser.rows[0].avatar_large
          }
        };
        console.log('✅ New user created:', user.username);
      } else {
        console.log('📝 Updating existing user...');
        const updatedUser = await pool.query(
          'UPDATE users SET last_login = NOW() WHERE steam_id = $1 RETURNING *',
          [profile.id]
        );
        
        user = {
          id: updatedUser.rows[0].id,
          steamId: updatedUser.rows[0].steam_id,
          username: updatedUser.rows[0].username,
          profileUrl: updatedUser.rows[0].profile_url,
          avatar: {
            small: updatedUser.rows[0].avatar_small,
            medium: updatedUser.rows[0].avatar_medium,
            large: updatedUser.rows[0].avatar_large
          }
        };
        console.log('✅ Existing user updated:', user.username);
      }
      
      console.log('✅ Authentication successful for:', user.username);
      return done(null, user);
    } catch (error) {
      console.error('❌ Authentication error:', error);
      console.error('❌ Error stack:', error.stack);
      return done(error);
    }
  }
));

passport.serializeUser((user, done) => {
  console.log('💾 Serializing user:', user.steamId);
  done(null, user.steamId);
});

passport.deserializeUser(async (steamId, done) => {
  try {
    console.log('💾 Deserializing user:', steamId);
    if (!pool) {
      throw new Error('Database pool not available for deserialization');
    }
    
    const userResult = await pool.query(
      'SELECT * FROM users WHERE steam_id = $1',
      [steamId]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found during deserialization:', steamId);
      return done(null, false);
    }
    
    const user = userResult.rows[0];
    const userObj = {
      id: user.id,
      steamId: user.steam_id,
      username: user.username,
      profileUrl: user.profile_url,
      avatar: {
        small: user.avatar_small,
        medium: user.avatar_medium,
        large: user.avatar_large
      }
    };
    
    console.log('✅ User deserialized:', userObj.username);
    done(null, userObj);
  } catch (error) {
    console.error('❌ Deserialize user error:', error);
    done(error);
  }
});

// View engine and routes
app.set('view engine', 'ejs');
app.set('views', './views');

// Routes
app.get('/', (req, res) => {
  console.log('🏠 Homepage accessed, user:', req.user ? req.user.username : 'Not logged in');
  res.render('index', { user: req.user });
});

app.get('/auth/steam',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/auth/steam/return', (req, res, next) => {
  console.log('🔄 Steam return callback received');
  passport.authenticate('steam', { 
    failureRedirect: '/error',
    failureMessage: true 
  })(req, res, (err) => {
    if (err) {
      console.error('❌ Steam auth failed:', err);
      return res.redirect('/error');
    }
    console.log('✅ Steam auth successful, redirecting to profile');
    res.redirect('/profile');
  });
});

app.get('/profile', (req, res) => {
  console.log('👤 Profile page accessed, user:', req.user ? req.user.username : 'Not authenticated');
  
  if (!req.isAuthenticated()) {
    console.log('❌ User not authenticated, redirecting to home');
    return res.redirect('/');
  }
  
  try {
    const userData = {
      username: req.user.username,
      steamId: req.user.steamId,
      profileUrl: req.user.profileUrl,
      avatar: {
        small: req.user.avatar?.small || '',
        medium: req.user.avatar?.medium || '',
        large: req.user.avatar?.large || ''
      }
    };
    
    console.log('✅ Rendering profile for:', userData.username);
    res.render('profile', { user: userData });
  } catch (error) {
    console.error('❌ Profile render error:', error);
    res.redirect('/error');
  }
});

app.get('/logout', (req, res) => {
  console.log('👋 Logout requested for:', req.user?.username);
  req.logout((err) => {
    if (err) { 
      console.error('❌ Logout error:', err);
      return res.redirect('/');
    }
    res.redirect('/');
  });
});

app.get('/error', (req, res) => {
  console.log('❌ Error page accessed');
  res.render('error', { 
    message: 'Something went wrong!',
    error: {} 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
