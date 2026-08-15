const express = require('express');
const http = require('http');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cloudinary = require('./config/cloudinary');
const { PORT } = require('./config/env');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const alertRoutes = require('./routes/alertRoutes');
const plotRoutes = require('./routes/plotRoutes');
const chatRoutes = require('./routes/chatRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const locationRoutes = require('./routes/locationRoutes');
const adminUserRoutes = require('./routes/adminUserRoutes');
const superAdminSettingsRoutes = require('./routes/superAdminSettingsRoutes');
const { getPublicSettings } = require('./controllers/superAdminSettingsController');
const authMiddleware = require('./middleware/auth');
const { setupChatSocket } = require('./socket/chatSocket');
const { ensureSuperAdmin } = require('./utils/superAdmin');

const app = express();
const httpServer = http.createServer(app);
const upload = multer({ storage: multer.memoryStorage() });
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://quiet-klepon-e16e88.netlify.app',
];

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization'],
  },
});
setupChatSocket(io);

// Do not allow database-backed routes to fail with an opaque 500 while the
// MongoDB connection is unavailable (for example, when Atlas blocks the IP).
app.use('/api', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Database is temporarily unavailable. Please try again shortly.',
    });
  }
  next();
});

app.get('/', (req, res) => {
  res.json({ message: 'Backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/plots', plotRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/admin', adminUserRoutes);
app.use('/api/admin', superAdminSettingsRoutes);
// Load this on every client app to display the name and logo selected by the super admin.
app.get('/api/settings', getPublicSettings);

app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({ message: 'Access granted', user: req.user });
});

app.post('/api/upload', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64Image}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'plot-backend',
    });

    res.json({ message: 'Upload successful', url: result.secure_url });
  } catch (error) {
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

async function startServer(port) {
  // The API remains available and responds with 503 until MongoDB/Atlas
  // connectivity is restored.
  await connectDB();
  await ensureSuperAdmin();

  httpServer.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer(Number(PORT) || 5000).catch((error) => {
  console.error('Server failed to start:', error.message);
  process.exit(1);
});
