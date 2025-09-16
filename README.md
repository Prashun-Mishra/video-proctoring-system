# 🎯 TubeDude - AI-Powered Video Proctoring System

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.x-green.svg)](https://www.mongodb.com/)
[![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-4.x-orange.svg)](https://www.tensorflow.org/js)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Netlify Status](https://api.netlify.com/api/v1/badges/video-proctoring-system/deploy-status)](https://app.netlify.com/sites/video-proctoring-system/deploys)

A comprehensive real-time video proctoring system for online interviews that uses advanced AI detection algorithms to monitor candidate behavior, detect violations, and generate detailed integrity reports.

## 🌐 Live Demo
🚀 **[Try the Live Application](https://video-proctoring-system.netlify.app)**

📊 **Sample Reports**: Available in the `sample-reports/` directory
- [Sample PDF Report](sample-reports/sample_proctoring_report.pdf)
- [Sample CSV Report](sample-reports/sample_proctoring_report.csv)

## 🚀 Features

### 🎥 **Real-Time Monitoring**
- **Eye Detection**: Advanced eye tracking to detect when candidates look away from screen
- **Face Detection**: Monitors face presence and detects multiple people
- **Object Detection**: Identifies unauthorized items (phones, books, notes, electronics)
- **Live Status Updates**: Real-time violation alerts and status indicators

### 📊 **Advanced Analytics**
- **Integrity Scoring**: Automated scoring system (0-100) based on violation severity
- **Detailed Reports**: Comprehensive proctoring reports with timeline and statistics
- **Event Logging**: Timestamped violation tracking with severity levels
- **Session Management**: Complete interview session lifecycle management

### 🔧 **Technical Features**
- **Video Recording**: Automatic session recording with secure storage
- **WebSocket Communication**: Real-time bidirectional communication
- **Responsive UI**: Modern, mobile-friendly interface
- **Database Integration**: MongoDB for persistent data storage

## 🛠️ Technology Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | HTML5, CSS3, JavaScript ES6+, TensorFlow.js, MediaPipe |
| **Backend** | Node.js, Express.js, Socket.io, Multer |
| **Database** | MongoDB with Mongoose ODM |
| **AI/ML** | TensorFlow.js, MediaPipe Face Detection, COCO-SSD |
| **Video** | WebRTC, MediaRecorder API, WebM format |
| **Deployment** | Docker-ready, Environment variables |

## 📋 Prerequisites

- **Node.js** 18.x or higher
- **MongoDB** 6.x or higher (local or cloud)
- **Modern Browser** with WebRTC support
- **Camera Access** for video detection

## ⚡ Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/tubedude-proctoring.git
cd tubedude-proctoring
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Create `.env` file in root directory:
```env
# Server Configuration
PORT=3000
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/video_proctoring
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/video_proctoring

# Session Configuration
SESSION_SECRET=your_super_secret_key_here

# File Upload Configuration
MAX_FILE_SIZE=100MB
UPLOAD_PATH=./uploads
```

### 4. Start MongoDB
```bash
# Local MongoDB
mongod

# OR use MongoDB Atlas (cloud)
# Update MONGODB_URI in .env file
```

### 5. Launch Application
```bash
# Development mode
npm run dev

# Production mode
npm start
```

### 6. Access Application
Open your browser and navigate to:
```
http://localhost:3000
```

## 📖 Usage Guide

### Starting an Interview Session

1. **Setup Phase**
   - Enter candidate's full name
   - Click "Start Interview" button
   - Grant camera and microphone permissions

2. **Interview Phase**
   - Monitor real-time detection status
   - View live violation counts
   - Observe visual detection indicators
   - Optional: Start/stop video recording

3. **Completion Phase**
   - Click "End Interview" to finish session
   - Generate comprehensive proctoring report
   - Download session recordings if needed

### Understanding Detection Indicators

| Indicator | Meaning | Visual Cue |
|-----------|---------|------------|
| 🟢 **Green Dots** | Eye positions detected | Active tracking |
| 🔵 **Blue Dot** | Eye center calculated | Gaze direction |
| 🔴 **Red Dot** | Screen center reference | Focus target |
| 🟡 **Yellow Line** | Gaze direction vector | Looking direction |

## 🔍 Detection Rules & Thresholds

### Focus Detection
- **Eye Tracking**: Uses MediaPipe keypoints for precise eye detection
- **Looking Away Threshold**: 0.4 normalized deviation from center
- **Violation Timer**: 22.5 seconds before triggering focus lost violation
- **Visual Feedback**: Real-time eye position and gaze direction indicators

### Face Detection
- **Absence Threshold**: 3 seconds without face detection
- **Multiple Faces**: Immediate violation when >1 person detected
- **Confidence Scoring**: Minimum 70% confidence for valid detection

### Object Detection
- **Unauthorized Items**: Phone, book, laptop, tablet, remote, keyboard, mouse
- **Detection Confidence**: 60% minimum confidence threshold
- **Throttling**: 3-second cooldown between same violation types

## 📊 Integrity Scoring System

### Base Scoring Algorithm
```javascript
Base Score: 100 points

Deductions:
- Focus Lost: -5 points per violation
- Face Absent: -10 points per violation  
- Multiple Faces: -15 points per violation
- Unauthorized Items: -20 points per violation

Final Score: Math.max(0, baseScore - totalDeductions)
```

### Score Interpretation
| Score Range | Integrity Level | Recommendation |
|-------------|----------------|----------------|
| 90-100 | **Excellent** | High integrity, no concerns |
| 70-89 | **Good** | Minor violations, acceptable |
| 50-69 | **Fair** | Moderate concerns, review needed |
| 0-49 | **Poor** | Significant violations, investigate |

## 🏗️ Project Structure

```
tubedude-proctoring/
├── 📁 public/                 # Frontend assets
│   ├── 📄 index.html         # Main application page
│   ├── 📄 app.js             # Frontend application logic
│   ├── 📄 detection.js       # AI detection algorithms
│   ├── 📄 styles.css         # UI styling
│   └── 📄 favicon.ico        # Application icon
├── 📁 uploads/               # File storage
│   └── 📁 videos/           # Recorded session videos
├── 📁 node_modules/         # Dependencies
├── 📄 server.js             # Express server & API routes
├── 📄 package.json          # Project configuration
├── 📄 package-lock.json     # Dependency lock file
├── 📄 .env                  # Environment variables
├── 📄 .gitignore           # Git ignore rules
└── 📄 README.md            # This documentation
```

## 🔧 API Endpoints

### Session Management
```http
POST /api/session/start      # Start new interview session
POST /api/session/end        # End interview session
GET  /api/session/:id/report # Get session report
```

### Violation Tracking
```http
POST /api/violation          # Log violation event
GET  /api/violations/:sessionId # Get session violations
```

### File Upload
```http
POST /api/upload/video       # Upload recorded video
```

## 🐳 Docker Deployment

### Build Docker Image
```bash
docker build -t tubedude-proctoring .
```

### Run with Docker Compose
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/video_proctoring
    depends_on:
      - mongo
  
  mongo:
    image: mongo:6
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

volumes:
  mongodb_data:
```

## 🚀 Deployment Options

### Option 1: Heroku
```bash
# Install Heroku CLI
heroku create tubedude-proctoring
heroku addons:create mongolab:sandbox
git push heroku main
```

### Option 2: Netlify (Frontend) + Railway (Backend)
```bash
# Deploy frontend to Netlify
npm run build
netlify deploy --prod --dir=public

# Deploy backend to Railway
railway login
railway new
railway up
```

### Option 3: DigitalOcean App Platform
```yaml
name: tubedude-proctoring
services:
- name: web
  source_dir: /
  github:
    repo: yourusername/tubedude-proctoring
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
```

## 🧪 Testing

### Run Tests
```bash
# Unit tests
npm test

# Integration tests  
npm run test:integration

# E2E tests
npm run test:e2e
```

### Manual Testing Checklist
- [ ] Camera permission granted
- [ ] Face detection working
- [ ] Eye tracking functional
- [ ] Object detection active
- [ ] Violation logging
- [ ] Report generation
- [ ] Video recording
- [ ] Session management

## 🔒 Security Considerations

- **Data Privacy**: All video data stored locally or in secure cloud storage
- **HTTPS Required**: Use SSL certificates in production
- **Input Validation**: All user inputs sanitized and validated
- **Session Management**: Secure session handling with proper cleanup
- **File Upload Security**: Restricted file types and size limits

## 🐛 Troubleshooting

### Common Issues

**Camera Not Working**
```bash
# Check browser permissions
# Ensure HTTPS in production
# Verify WebRTC support
```

**MongoDB Connection Failed**
```bash
# Check MongoDB service status
# Verify connection string in .env
# Ensure network connectivity
```

**Detection Not Working**
```bash
# Check TensorFlow.js model loading
# Verify camera feed quality
# Ensure adequate lighting
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**Your Name**
- GitHub: [@yourusername](https://github.com/yourusername)
- Email: your.email@example.com
- LinkedIn: [Your LinkedIn](https://linkedin.com/in/yourprofile)

## 🙏 Acknowledgments

- [TensorFlow.js](https://www.tensorflow.org/js) for machine learning capabilities
- [MediaPipe](https://mediapipe.dev/) for face detection algorithms
- [Socket.io](https://socket.io/) for real-time communication
- [MongoDB](https://www.mongodb.com/) for data persistence

---

⭐ **Star this repository if you found it helpful!**
