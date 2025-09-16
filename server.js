const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
fs.ensureDirSync('./uploads/videos');

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/video_proctoring', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Interview Session Schema
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true, required: true },
  candidateName: { type: String, required: true },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  duration: Number,
  events: [{
    eventType: { type: String, required: true },
    timestamp: { type: Date, required: true },
    description: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
  }],
  violations: {
    focusLost: { type: Number, default: 0 },
    faceAbsent: { type: Number, default: 0 },
    multipleFaces: { type: Number, default: 0 },
    unauthorizedItems: { type: Number, default: 0 }
  },
  integrityScore: { type: Number, default: 100 },
  videoPath: String,
  status: { type: String, enum: ['active', 'completed', 'terminated'], default: 'active' }
});

const Session = mongoose.model('Session', sessionSchema);

// Multer configuration for video uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/videos');
  },
  filename: function (req, file, cb) {
    cb(null, req.body.sessionId + '_' + Date.now() + '.webm');
  }
});

const upload = multer({ storage: storage });

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create new interview session
app.post('/api/session/create', async (req, res) => {
  try {
    const { candidateName } = req.body;
    const sessionId = uuidv4();
    
    const session = new Session({
      sessionId,
      candidateName,
      events: []
    });
    
    await session.save();
    res.json({ sessionId, message: 'Session created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// End interview session
app.post('/api/session/end', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    session.endTime = new Date();
    session.duration = Math.round((session.endTime - session.startTime) / 1000); // in seconds
    session.status = 'completed';
    
    // Calculate integrity score
    let score = 100;
    score -= session.violations.focusLost * 5;
    score -= session.violations.faceAbsent * 10;
    score -= session.violations.multipleFaces * 15;
    score -= session.violations.unauthorizedItems * 20;
    session.integrityScore = Math.max(0, score);
    
    await session.save();
    res.json({ message: 'Session ended successfully', integrityScore: session.integrityScore });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session report
app.get('/api/session/:sessionId/report', async (req, res) => {
  try {
    console.log(`📊 Report requested for session: ${req.params.sessionId}`);
    const session = await Session.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      console.log(`❌ Session not found: ${req.params.sessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }
    console.log(`✅ Session found, sending report data:`, {
      sessionId: session.sessionId,
      candidateName: session.candidateName,
      violations: session.violations,
      integrityScore: session.integrityScore
    });
    res.json(session);
  } catch (error) {
    console.error(`💥 Error generating report:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Upload video
app.post('/api/upload/video', upload.single('video'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = await Session.findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    session.videoPath = req.file.path;
    await session.save();
    
    res.json({ message: 'Video uploaded successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io for real-time events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });
  
  socket.on('detection-event', async (data) => {
    try {
      const { sessionId, eventType, description, severity } = data;
      console.log(`🚨 VIOLATION RECEIVED: ${eventType} - ${description}`);
      
      const session = await Session.findOne({ sessionId });
      
      if (session) {
        // Add event to session
        const newEvent = {
          eventType: eventType,
          timestamp: new Date(),
          description,
          severity: severity || 'medium'
        };
        session.events.push(newEvent);
        
        // Update violation counts
        switch (eventType) {
          case 'focus_lost':
            session.violations.focusLost++;
            console.log(`📊 Focus Lost Count: ${session.violations.focusLost}`);
            break;
          case 'face_absent':
            session.violations.faceAbsent++;
            console.log(`📊 Face Absent Count: ${session.violations.faceAbsent}`);
            break;
          case 'multiple_faces':
            session.violations.multipleFaces++;
            console.log(`📊 Multiple Faces Count: ${session.violations.multipleFaces}`);
            break;
          case 'unauthorized_item':
            session.violations.unauthorizedItems++;
            console.log(`📊 Unauthorized Items Count: ${session.violations.unauthorizedItems}`);
            break;
        }
        
        await session.save();
        console.log(`💾 Session saved with violation: ${eventType}`);
        
        // Broadcast event to all clients in the session
        io.to(sessionId).emit('real-time-event', {
          eventType,
          description,
          timestamp: new Date(),
          severity,
          violationCounts: session.violations
        });
        
        console.log(`📡 Event broadcasted to session: ${sessionId}`);
      } else {
        console.error(`❌ Session not found: ${sessionId}`);
      }
    } catch (error) {
      console.error('❌ Error handling detection event:', error);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the application`);
});
