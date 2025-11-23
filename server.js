// Passport Steam Strategy with better error handling
passport.use(new SteamStrategy({
    returnURL: `${process.env.BASE_URL || 'https://trading.tf'}/auth/steam/return`,
    realm: process.env.BASE_URL || 'https://trading.tf',
    apiKey: process.env.STEAM_API_KEY
  },
  async (identifier, profile, done) => {
    try {
      console.log('🔐 Steam authentication attempt for:', profile.displayName);
      
      // Check if database connection is working
      if (!pool) {
        throw new Error('Database connection not available');
      }

      // Check if user exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE steam_id = $1',
        [profile.id]
      );
      
      let user;
      
      if (existingUser.rows.length === 0) {
        console.log('📝 Creating new user...');
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
        console.log('📝 Updating existing user...');
        // Update existing user
        const updatedUser = await pool.query(
          'UPDATE users SET last_login = NOW(), username = $1 WHERE steam_id = $2 RETURNING *',
          [profile.displayName, profile.id]
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
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        profileId: profile?.id,
        profileName: profile?.displayName
      });
      return done(error);
    }
  }
));

// Fix the return route with better error handling
app.get('/auth/steam/return',
  (req, res, next) => {
    passport.authenticate('steam', { 
      failureRedirect: '/error',
      failureMessage: true 
    })(req, res, next);
  },
  (req, res) => {
    console.log('✅ User successfully authenticated, redirecting to profile:', req.user?.username);
    res.redirect('/profile');
  }
);

// Add a simple profile route that works even if database fails
app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  
  try {
    // Simple profile data - works even if database has issues
    const userData = {
      username: req.user.username || 'Steam User',
      steamId: req.user.steamId || 'Unknown',
      profileUrl: req.user.profileUrl || '#',
      avatar: {
        small: req.user.avatar?.small || req.user.avatar_small || '',
        medium: req.user.avatar?.medium || req.user.avatar_medium || '',
        large: req.user.avatar?.large || req.user.avatar_large || '/default-avatar.png'
      }
    };
    
    console.log('👤 Rendering profile for:', userData.username);
    res.render('profile', { user: userData });
  } catch (error) {
    console.error('❌ Profile render error:', error);
    res.redirect('/error');
  }
});
