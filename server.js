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

console.log('=== DATABASE CONNECTION DEBUG ===');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 50) || 'EMPTY');

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

// Test connection and initialize database
async function initializeApp() {
  try {
    console.log('🔄 Testing database connection...');
    const client = await pool.connect();
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    const result = await client.query('SELECT NOW() as current_time');
    console.log('✅ Database query successful. Time:', result.rows[0].current_time);
    
    // Create users table if not exists
    await client.query(`
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
    
    client.release();
  } catch (error) {
    console.log('❌ Database initialization failed:', error.message);
    console.log('Error details:', error);
  }
}

// Initialize the app
initializeApp();

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

// ... rest of your passport and route code remains the same
