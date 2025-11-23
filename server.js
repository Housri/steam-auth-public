const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Supabase PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Create users table if not exists
async function initializeDatabase() {
  try {
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

// Session configuration for production
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // true in production
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Steam Strategy
passport.use(new SteamStrategy({
    returnURL: `https://trading.tf/auth/steam/return`,
    realm: `https://trading.tf`,
    apiKey: process.env.STEAM_API_KEY
  },
  // ...
  async (identifier, profile, done) => {
    try {
      console.log('🔐 Steam authentication attempt for:', profile.displayName);
      
      // Check if user exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE steam_id = $1',
        [profile.id]
      );
      
      let user;
      
      if (existingUser.rows.length === 0) {
        // Create new user
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
          },
          lastLogin: new Date(),
          createdAt: newUser.rows[0].created_at
        };
        console.log('✅ New user created:', user.username);
      } else {
        // Update existing user
        const updatedUser = await pool.query(
          'UPDATE users SET last_login = NOW(), username = $1, profile_url = $2, avatar_small = $3, avatar_medium = $4, avatar_large = $5 WHERE steam_id = $6 RETURNING *',
          [
            profile.displayName,
            profile._json.profileurl,
            profile._json.avatar,
            profile._json.avatarmedium,
            profile._json.avatarfull,
            profile.id
          ]
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
          },
          lastLogin: new Date(),
          createdAt: updatedUser.rows[0].created_at
        };
        console.log('✅ Existing user updated:', user.username);
      }
      
      return done(null, user);
    } catch (error) {
      console.error('❌ Authentication error:', error);
      return done(error);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.steamId);
});

passport.deserializeUser(async (steamId, done) => {
  try {
    const userResult = await pool.query(
      'SELECT * FROM users WHERE steam_id = $1',
      [steamId]
    );
    
    if (userResult.rows.length === 0) {
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
      },
      lastLogin: user.last_login,
      createdAt: user.created_at
    };
    
    done(null, userObj);
  } catch (error) {
    console.error('❌ Deserialize user error:', error);
    done(error);
  }
});

// View engine and routes
app.set('view engine', 'ejs');
app.set('views', './views');

// Basic route
app.get('/', (req, res) => {
  res.render('index', { user: req.user });
});

// Steam authentication routes
app.get('/auth/steam',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/auth/steam/return',
  passport.authenticate('steam', { 
    failureRedirect: '/',
    failureMessage: true 
  }),
  (req, res) => {
    // Successful authentication
    console.log('✅ User successfully authenticated:', req.user.username);
    res.redirect('/profile');
  }
);

// Profile route with error handling
app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  
  try {
    // Ensure user data is properly structured
    const userData = {
      username: req.user.username || 'Unknown',
      steamId: req.user.steamId || 'Unknown',
      profileUrl: req.user.profileUrl || '#',
      avatar: {
        small: req.user.avatar?.small || '',
        medium: req.user.avatar?.medium || '',
        large: req.user.avatar?.large || ''
      },
      createdAt: req.user.createdAt || new Date(),
      lastLogin: req.user.lastLogin || new Date()
    };
    
    console.log('👤 Rendering profile for:', userData.username);
    res.render('profile', { user: userData });
  } catch (error) {
    console.error('❌ Profile render error:', error);
    res.status(500).render('error', { 
      message: 'Error loading profile',
      error: process.env.NODE_ENV === 'production' ? {} : error 
    });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  const username = req.user?.username || 'Unknown';
  req.logout((err) => {
    if (err) { 
      console.error('❌ Logout error:', err);
      return res.redirect('/');
    }
    console.log('👋 User logged out:', username);
    res.redirect('/');
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Database test route
/ Fixed database test route
app.get('/test-db', async (req, res) => {
  try {
    console.log('Testing database connection...');
    
    // Test basic connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    const currentTime = result.rows[0].current_time;
    
    // Test users table
    const userResult = await client.query('SELECT COUNT(*) as user_count FROM users');
    const userCount = userResult.rows[0].user_count;
    
    client.release();
    
    res.json({ 
      success: true, 
      databaseTime: currentTime,
      userCount: parseInt(userCount),
      message: 'Database connection successful!' 
    });
  } catch (error) {
    console.error('❌ Database test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      connectionString: process.env.DATABASE_URL ? 'DATABASE_URL is set' : 'DATABASE_URL is missing'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).render('error', { 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'production' ? {} : err 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'Page not found',
    error: {} 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Base URL: ${process.env.BASE_URL || 'http://localhost:3000'}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Database test: http://localhost:${PORT}/test-db`);
});
