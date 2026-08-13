const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { JWT_SECRET } = require('../config/env');
const User = require('../models/User');

const USER_ROOM_PREFIX = 'user:';

function userRoom(userId) {
  return `${USER_ROOM_PREFIX}${userId}`;
}

function getToken(socket) {
  const authorization = socket.handshake.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  return socket.handshake.auth?.token;
}

function setupChatSocket(io) {
  // Socket connections use the same JWT as the REST API. This prevents a
  // client from listening to another user's incoming calls.
  io.use(async (socket, next) => {
    const token = getToken(socket);
    if (!token) return next(new Error('Authentication token missing'));

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded.id || !mongoose.Types.ObjectId.isValid(decoded.id)) {
        return next(new Error('Invalid authenticated user'));
      }
      const user = await User.findById(decoded.id).select('accountStatus').lean();
      if (!user || user.accountStatus === 'Rejected') {
        return next(new Error('Account rejected by super admin'));
      }
      socket.user = decoded;
      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const fromUserId = String(socket.user.id);
    socket.join(userRoom(fromUserId));

    socket.emit('socket:ready', { userId: fromUserId });

    // All call events are intentionally relayed by user room rather than a
    // client-supplied socket ID. A user can therefore receive a call on more
    // than one signed-in browser/device.
    const relayCallEvent = (eventName) => async (payload = {}, acknowledge) => {
      const toUserId = String(payload.toUserId || '');
      const callId = String(payload.callId || '');

      if (!mongoose.Types.ObjectId.isValid(toUserId) || toUserId === fromUserId) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'A valid recipient is required' });
        }
        return;
      }

      if (!callId || callId.length > 100) {
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: false, message: 'A valid call id is required' });
        }
        return;
      }

      const recipientSockets = await io.in(userRoom(toUserId)).fetchSockets();
      io.to(userRoom(toUserId)).emit(eventName, {
        ...payload,
        // Never allow the browser to spoof the caller identity.
        fromUserId,
        toUserId: undefined,
        sentAt: new Date().toISOString(),
      });

      if (typeof acknowledge === 'function') {
        acknowledge({ ok: true, delivered: recipientSockets.length > 0 });
      }
    };

    socket.on('call:invite', relayCallEvent('call:incoming'));
    socket.on('call:accept', relayCallEvent('call:accepted'));
    socket.on('call:reject', relayCallEvent('call:rejected'));
    socket.on('call:end', relayCallEvent('call:ended'));

    // These are WebRTC signaling messages. `signal` carries an SDP offer or
    // answer and `candidate` carries an ICE candidate.
    socket.on('call:signal', relayCallEvent('call:signal'));
  });
}

module.exports = { setupChatSocket };
