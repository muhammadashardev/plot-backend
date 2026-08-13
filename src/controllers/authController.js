const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const https = require('https');
const User = require('../models/User');
const {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
  FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_CALLBACK_URL,
  FACEBOOK_GRAPH_API_VERSION, FRONTEND_URL,
} = require('../config/env');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');

const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);

function publicUser(user) {
  const data = user.toObject ? user.toObject() : user;
  const { password, googleId, facebookId, __v, ...safeUser } = data;
  return safeUser;
}

function requestFacebook(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          return reject(new Error('Facebook returned an invalid response'));
        }

        if (response.statusCode < 200 || response.statusCode >= 300 || data.error) {
          return reject(new Error(data.error?.message || 'Facebook API request failed'));
        }
        resolve(data);
      });
    }).on('error', reject);
  });
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function frontendRedirect(token) {
  const url = new URL(FRONTEND_URL);
  // A URL fragment is never sent to the frontend server, avoiding JWT leakage in server logs.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function rejectedAccountResponse(res, user) {
  return res.status(403).json({
    code: 'ACCOUNT_REJECTED',
    message: 'Your account has been rejected by the super admin. Please contact support for assistance.',
    accountStatus: user.accountStatus,
    rejectionReason: user.rejectionReason || '',
  });
}

async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    const passwordError = await validatePasswordPolicy(password);
    if (passwordError) return res.status(400).json({ message: passwordError });

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const hashedPassword = await hashPassword(password);
    const user = await User.create({ name, email, password: hashedPassword, authProvider: 'local' });
    const token = generateToken(user);

    res.status(201).json({ message: 'User registered successfully', token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isPasswordValid = await comparePassword(password, user.password || '');
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    if (user.accountStatus === 'Rejected') {
      return rejectedAccountResponse(res, user);
    }

    const token = generateToken(user);
    res.json({ message: 'Login successful', token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
}

async function googleLogin(req, res) {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: name || email,
        email,
        googleId,
        avatar: picture,
        authProvider: 'google',
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      user.authProvider = 'google';
      user.avatar = picture || user.avatar;
      await user.save();
    }

    if (user.accountStatus === 'Rejected') {
      return rejectedAccountResponse(res, user);
    }

    const jwtToken = generateToken(user);
    res.json({ message: 'Google login successful', token: jwtToken, user: publicUser(user) });
  } catch (error) {
    res.status(401).json({ message: 'Google authentication failed', error: error.message });
  }
}

async function googleCallback(req, res) {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.status(400).json({ message: 'Google authentication was denied', error });
    }

    if (!code) {
      return res.status(400).json({ message: 'Google authorization code is required' });
    }

    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: name || email,
        email,
        googleId,
        avatar: picture,
        authProvider: 'google',
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      user.authProvider = 'google';
      user.avatar = picture || user.avatar;
      await user.save();
    }

    if (user.accountStatus === 'Rejected') {
      return rejectedAccountResponse(res, user);
    }

    const jwtToken = generateToken(user);
    res.json({ message: 'Google callback successful', token: jwtToken, user: publicUser(user) });
  } catch (error) {
    res.status(401).json({ message: 'Google callback failed', error: error.message });
  }
}

function facebookLogin(req, res) {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    return res.status(503).json({ message: 'Facebook login is not configured' });
  }

  const state = crypto.randomBytes(32).toString('hex');
  res.cookie('facebook_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: FACEBOOK_CALLBACK_URL.startsWith('https://'),
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/facebook/callback',
  });

  const authorizationUrl = new URL(`https://www.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/dialog/oauth`);
  authorizationUrl.search = new URLSearchParams({
    client_id: FACEBOOK_APP_ID,
    redirect_uri: FACEBOOK_CALLBACK_URL,
    state,
    response_type: 'code',
    scope: 'email,public_profile',
  }).toString();
  return res.redirect(302, authorizationUrl.toString());
}

async function facebookCallback(req, res) {
  try {
    const { code, error, error_reason, state } = req.query;
    if (error) {
      return res.status(400).json({ message: 'Facebook authentication was denied', error: error_reason || error });
    }
    if (!code) return res.status(400).json({ message: 'Facebook authorization code is required' });

    const savedState = getCookie(req, 'facebook_oauth_state');
    res.clearCookie('facebook_oauth_state', { path: '/api/auth/facebook/callback' });
    const receivedState = String(state || '');
    if (!savedState || !state || savedState.length !== receivedState.length
      || !crypto.timingSafeEqual(Buffer.from(savedState), Buffer.from(receivedState))) {
      return res.status(400).json({ message: 'Invalid or expired Facebook OAuth state' });
    }
    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
      return res.status(503).json({ message: 'Facebook login is not configured' });
    }

    const tokenUrl = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: FACEBOOK_APP_ID,
      client_secret: FACEBOOK_APP_SECRET,
      redirect_uri: FACEBOOK_CALLBACK_URL,
      code: String(code),
    }).toString();
    const tokenData = await requestFacebook(tokenUrl);
    if (!tokenData.access_token) throw new Error('Facebook access token was not returned');

    const profileUrl = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_API_VERSION}/me`);
    profileUrl.search = new URLSearchParams({
      fields: 'id,name,email,picture.type(large)',
      access_token: tokenData.access_token,
    }).toString();
    const profile = await requestFacebook(profileUrl);
    const email = profile.email && String(profile.email).trim().toLowerCase();
    if (!profile.id || !email) {
      return res.status(400).json({ message: 'Facebook did not provide the required user ID and email' });
    }

    let user = await User.findOne({ email });
    const avatar = profile.picture?.data?.url;
    if (!user) {
      user = await User.create({
        name: profile.name || email,
        email,
        facebookId: String(profile.id),
        avatar,
        authProvider: 'facebook',
      });
    } else if (!user.facebookId) {
      user.facebookId = String(profile.id);
      user.authProvider = 'facebook';
      user.avatar = avatar || user.avatar;
      await user.save();
    } else if (user.facebookId !== String(profile.id)) {
      return res.status(401).json({ message: 'Facebook account does not match the existing user' });
    }

    if (user.accountStatus === 'Rejected') return rejectedAccountResponse(res, user);
    const jwtToken = generateToken(user);
    return res.redirect(302, frontendRedirect(jwtToken));
  } catch (error) {
    return res.status(401).json({ message: 'Facebook authentication failed', error: error.message });
  }
}

module.exports = { register, login, googleLogin, googleCallback, facebookLogin, facebookCallback };
