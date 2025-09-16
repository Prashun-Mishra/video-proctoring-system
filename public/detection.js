class DetectionSystem {
    constructor() {
        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.cocoModel = null;
        this.faceMesh = null;
        this.socket = null;
        this.sessionId = null;
        
        // Detection state
        this.isDetecting = false;
        this.lastFaceTime = Date.now();
        // Reduce thresholds for easier testing
        this.faceAbsentThreshold = 3000; // 3 seconds
        this.focusLostThreshold = 22500; // 22.5 seconds (20-25 seconds as requested)
        
        // Focus tracking state
        this.focusLostStartTime = null;
        this.lastFocusState = true; // true = focused, false = not focused
        this.lastViolationTime = 0;
        this.violationThrottle = 3000; // 3 seconds between violations
        
        // Eye detection state
        this.eyeDetectionMode = true; // Use eye detection instead of face position
        this.eyeClosedThreshold = 0.3; // Threshold for detecting closed eyes
        this.lookingAwayThreshold = 0.4; // Threshold for detecting looking away
        
        // Drowsiness detection
        this.eyeClosureHistory = [];
        this.eyeClosureWindowSize = 10; // Track last 10 measurements
        this.drowsinessThreshold = 0.6; // 60% of measurements show closed eyes
        this.drowsinessStartTime = null;
        this.drowsinessAlertThreshold = 3000; // 3 seconds of drowsiness
        
        // Audio detection
        this.audioContext = null;
        this.audioAnalyser = null;
        this.audioDataArray = null;
        this.backgroundNoiseThreshold = 50; // Adjust based on testing
        this.voiceDetectionActive = false;
        this.lastVoiceDetectionTime = 0;
        
        // Real-time alerts
        this.alertQueue = [];
        this.maxAlerts = 5;
        this.alertDisplayTime = 5000; // 5 seconds
        
        // Initialize violation counters to 0
        this.violations = {
            'face_absent': 0,
            'focus_lost': 0,
            'multiple_faces': 0,
            'unauthorized_item': 0,
            'drowsiness': 0,
            'background_audio': 0
        };
        this.detectionInterval = null;
        
        // Face tracking
        this.faceCount = 0;
        this.isLookingAtScreen = true;
        this.faceAbsentStartTime = null;
        
        // Unauthorized items to detect
        this.unauthorizedItems = [
            'cell phone', 'book', 'laptop', 'tablet', 'remote', 'keyboard',
            'mouse', 'tv', 'monitor', 'computer', 'phone'
        ];
        
        // Add debugging flag
        this.debugMode = true; // Turn on debug logging to troubleshoot violation counting
        
        // Detection counters
        this.violations = {
            focusLost: 0,
            faceAbsent: 0,
            multipleFaces: 0,
            unauthorizedItems: 0
        };
    }
    
    setSocket(socket, sessionId) {
        this.socket = socket;
        this.sessionId = sessionId;
        console.log('Socket and session ID set for detection system');
    }
    
    setViolationCallback(callback) {
        this.onViolation = callback;
        console.log('Violation callback set for detection system');
    }
    
    async initialize(video, canvas, socket, sessionId) {
        this.video = video;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.socket = socket;
        this.sessionId = sessionId;
        
        // Set canvas size to match video
        this.canvas.width = video.videoWidth || 640;
        this.canvas.height = video.videoHeight || 480;
        
        try {
            // Load TensorFlow.js COCO-SSD model for object detection
            console.log('Loading COCO-SSD model...');
            this.cocoModel = await cocoSsd.load();
            console.log('COCO-SSD model loaded successfully');
            
            // Initialize MediaPipe Face Mesh
            console.log('Initializing MediaPipe Face Mesh...');
            await this.initializeFaceMesh();
            console.log('MediaPipe Face Mesh initialized successfully');
            
            return true;
        } catch (error) {
            console.error('Error initializing detection models:', error);
            return false;
        }
    }
    
    async initializeFaceMesh() {
        try {
            // Initialize TensorFlow.js Face Detection model
            console.log('Loading TensorFlow.js Face Detection model...');
            
            const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
            const detectorConfig = {
                runtime: 'tfjs',
                maxFaces: 3,
                refineLandmarks: true,
                returnTensors: false
            };
            
            this.faceDetector = await faceDetection.createDetector(model, detectorConfig);
            console.log('Face detection model loaded successfully');
            
            this.faceMesh = {
                initialized: true,
                detectFaces: async (video) => {
                    return this.detectFacesWithTensorFlow(video);
                }
            };
        } catch (error) {
            console.warn('Failed to load TensorFlow face detection, falling back to simplified detection:', error);
            this.faceMesh = {
                initialized: true,
                detectFaces: async (video) => {
                    return this.detectFacesSimplified(video);
                }
            };
        }
    }
    
    async detectFacesWithTensorFlow(video) {
        const faces = [];
        
        if (!video || video.videoWidth === 0 || video.videoHeight === 0 || !this.faceDetector) {
            return faces;
        }
        
        try {
            // Use TensorFlow.js Face Detection with landmarks enabled
            const predictions = await this.faceDetector.estimateFaces(video, {
                flipHorizontal: false,
                staticImageMode: false
            });
            
            if (this.debugMode) {
                console.log(`TensorFlow face detection: ${predictions.length} faces found`);
            }
            
            predictions.forEach((prediction, index) => {
                const box = prediction.box;
                const confidence = prediction.score || 0.8;
                
                // Log landmarks data for debugging
                if (prediction.keypoints) {
                    console.log(`Face ${index + 1}: ${prediction.keypoints.length} landmarks found`);
                } else {
                    console.log(`Face ${index + 1}: No landmarks found`);
                }
                
                faces.push({
                    x: box.xMin,
                    y: box.yMin,
                    width: box.width,
                    height: box.height,
                    confidence: confidence,
                    landmarks: prediction.keypoints || null
                });
                
                if (this.debugMode) {
                    console.log(`Face ${index + 1}: confidence ${Math.round(confidence * 100)}%`);
                }
            });
            
        } catch (error) {
            console.error('TensorFlow face detection error:', error);
            // Fallback to simplified detection
            return this.detectFacesSimplified(video);
        }
        
        return faces;
    }
    
    extractLandmarks(prediction) {
        // Extract key landmarks from TensorFlow prediction
        const keypoints = prediction.keypoints || [];
        const landmarks = {};
        
        // Map common facial landmarks
        keypoints.forEach((point, index) => {
            switch(index) {
                case 0: landmarks.rightEye = { x: point.x, y: point.y }; break;
                case 1: landmarks.leftEye = { x: point.x, y: point.y }; break;
                case 2: landmarks.nose = { x: point.x, y: point.y }; break;
                case 3: landmarks.mouth = { x: point.x, y: point.y }; break;
                case 4: landmarks.rightEar = { x: point.x, y: point.y }; break;
                case 5: landmarks.leftEar = { x: point.x, y: point.y }; break;
            }
        });
        
        // Calculate gaze direction based on eye positions
        if (landmarks.leftEye && landmarks.rightEye && landmarks.nose) {
            const eyeCenter = {
                x: (landmarks.leftEye.x + landmarks.rightEye.x) / 2,
                y: (landmarks.leftEye.y + landmarks.rightEye.y) / 2
            };
            
            landmarks.gazeDirection = {
                x: landmarks.nose.x - eyeCenter.x,
                y: landmarks.nose.y - eyeCenter.y
            };
        } else {
            // Fallback gaze direction
            landmarks.gazeDirection = { x: 0, y: 0 };
        }
        
        return landmarks;
    }
    
    detectFacesSimplified(video) {
        const faces = [];
        
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
            return faces;
        }
        
        try {
            // Simple detection: if video is playing and has content, assume face is present
            // This is a fallback for demo purposes
            const hasVideoContent = video.currentTime > 0 && !video.paused && !video.ended && video.readyState >= 2;
            
            if (hasVideoContent) {
                // Create a temporary canvas for analysis
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCanvas.width = video.videoWidth;
                tempCanvas.height = video.videoHeight;
                
                tempCtx.drawImage(video, 0, 0);
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                
                // Check if there's significant content in the video
                const avgBrightness = this.calculateAverageBrightness(imageData);
                
                // If there's reasonable brightness variation, assume face is present
                if (avgBrightness > 30 && avgBrightness < 250) {
                    faces.push({
                        x: tempCanvas.width * 0.2,
                        y: tempCanvas.height * 0.15,
                        width: tempCanvas.width * 0.6,
                        height: tempCanvas.height * 0.7,
                        landmarks: this.generateMockLandmarks(tempCanvas.width, tempCanvas.height),
                        confidence: 0.8 // High confidence for demo
                    });
                }
            }
        } catch (error) {
            console.error('Face detection error:', error);
        }
        
        return faces;
    }
    
    detectFaceInImageData(imageData, width, height) {
        const data = imageData.data;
        let skinPixels = 0;
        let totalPixels = 0;
        let brightPixels = 0;
        let avgBrightness = 0;
        
        // Analyze multiple regions for better detection
        const regions = [
            { x: width * 0.3, y: height * 0.2, w: width * 0.4, h: height * 0.6 }, // Center face area
            { x: width * 0.2, y: height * 0.15, w: width * 0.6, h: height * 0.7 }, // Wider area
        ];
        
        let bestDetection = { detected: false, confidence: 0 };
        
        for (const region of regions) {
            skinPixels = 0;
            totalPixels = 0;
            brightPixels = 0;
            avgBrightness = 0;
            
            for (let y = Math.max(0, Math.floor(region.y)); y < Math.min(height, Math.floor(region.y + region.h)); y += 2) {
                for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(width, Math.floor(region.x + region.w)); x += 2) {
                    const index = (y * width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    
                    const brightness = (r + g + b) / 3;
                    avgBrightness += brightness;
                    
                    // Multiple detection methods
                    if (this.isSkinTone(r, g, b)) {
                        skinPixels++;
                    }
                    
                    if (brightness > 60 && brightness < 220) {
                        brightPixels++;
                    }
                    
                    totalPixels++;
                }
            }
            
            if (totalPixels > 0) {
                avgBrightness /= totalPixels;
                const skinRatio = skinPixels / totalPixels;
                const brightRatio = brightPixels / totalPixels;
                
                // Combined confidence score
                let confidence = 0;
                
                // Skin tone detection
                if (skinRatio > 0.05 && skinPixels > 30) {
                    confidence += skinRatio * 0.6;
                }
                
                // Brightness pattern detection
                if (brightRatio > 0.2 && avgBrightness > 60 && avgBrightness < 220) {
                    confidence += brightRatio * 0.4;
                }
                
                // Motion detection (simple variance check)
                if (avgBrightness > 40) {
                    confidence += 0.1;
                }
                
                confidence = Math.min(confidence, 1);
                
                if (confidence > bestDetection.confidence) {
                    bestDetection = {
                        detected: confidence > 0.1, // Very low threshold to ensure detection
                        x: region.x,
                        y: region.y,
                        width: region.w,
                        height: region.h,
                        confidence: confidence
                    };
                }
                
                if (this.debugMode) {
                    console.log(`Region detection - confidence: ${confidence.toFixed(3)}, detected: ${confidence > 0.1}`);
                }
            }
        }
        
        return bestDetection;
    }
    
    isSkinTone(r, g, b) {
        // Enhanced skin tone detection with broader range
        // Multiple skin tone ranges for better diversity support
        const conditions = [
            // Light skin tones
            (r > 95 && g > 40 && b > 20 && Math.max(r, g, b) - Math.min(r, g, b) > 15 && Math.abs(r - g) > 15 && r > g && r > b),
            // Medium skin tones
            (r > 80 && g > 50 && b > 30 && r > b && g > b && Math.abs(r - g) < 40),
            // Darker skin tones
            (r > 60 && g > 40 && b > 25 && r > b && (r - b) > 10 && (g - b) > 5),
            // Additional range for varied lighting
            (r > 70 && g > 35 && b > 15 && r > g && r > b && (r + g + b) > 150)
        ];
        
        return conditions.some(condition => condition);
    }
    
    calculateAverageBrightness(imageData) {
        let total = 0;
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            total += (r + g + b) / 3;
        }
        
        return total / (data.length / 4);
    }
    
    generateMockLandmarks(width, height, faceData = null) {
        // Generate mock facial landmarks for gaze detection
        let centerX = width * 0.5;
        let centerY = height * 0.4;
        
        if (faceData) {
            centerX = faceData.x + faceData.width / 2;
            centerY = faceData.y + faceData.height / 2;
        }
        
        // Add some randomness to simulate real gaze movement
        const gazeOffsetX = (Math.random() - 0.5) * 20;
        const gazeOffsetY = (Math.random() - 0.5) * 10;
        
        return {
            leftEye: { x: centerX - 30 + gazeOffsetX, y: centerY + gazeOffsetY },
            rightEye: { x: centerX + 30 + gazeOffsetX, y: centerY + gazeOffsetY },
            nose: { x: centerX, y: centerY + 20 },
            mouth: { x: centerX, y: centerY + 50 },
            gazeDirection: { x: gazeOffsetX, y: gazeOffsetY }
        };
    }
    
    startDetection() {
        if (this.isDetecting) return;
        
        this.isDetecting = true;
        this.lastFaceTime = Date.now();
        this.lastFocusTime = Date.now();
        
        // Start detection loop - more frequent for real-time detection
        this.detectionInterval = setInterval(() => {
            this.performDetection();
        }, 500); // Check every 500ms for better real-time performance
        
        console.log('Detection started');
    }
    
    stopDetection() {
        this.isDetecting = false;
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
        console.log('Detection stopped');
    }
    
    async performDetection() {
        if (!this.isDetecting || !this.video || !this.cocoModel) return;
        
        try {
            // Clear canvas
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Perform face detection
            await this.detectFaces();
            
            // Perform object detection
            await this.detectObjects();
            
            // Update UI
            this.updateDetectionUI();
            
        } catch (error) {
            console.error('Detection error:', error);
        }
    }
    
    async detectFaces() {
        try {
            const faces = await this.faceMesh.detectFaces(this.video);
            this.faceCount = faces.length;
            
            const currentTime = Date.now();
            
            if (this.debugMode) {
                console.log(`Face detection: ${faces.length} faces found`);
                if (faces.length > 0) {
                    console.log(`Face confidence: ${Math.round(faces[0].confidence * 100)}%`);
                }
            }
            
            if (faces.length === 0) {
                // No face detected
                if (!this.faceAbsentStartTime) {
                    this.faceAbsentStartTime = currentTime;
                    if (this.debugMode) console.log('Face absent timer started');
                }
                
                const timeAbsent = currentTime - this.faceAbsentStartTime;
                
                if (timeAbsent > this.faceAbsentThreshold) {
                    this.triggerViolation('face_absent', `No face detected for ${Math.round(timeAbsent/1000)} seconds`, 'high');
                    this.faceAbsentStartTime = currentTime; // Reset to avoid spam
                }
                
                if (this.debugMode) {
                    console.log(`⏱️ Face absent for ${Math.round(timeAbsent/1000)}s (threshold: ${this.faceAbsentThreshold/1000}s)`);
                }
                
                this.updateStatus('faceStatus', `No face detected (${Math.round(timeAbsent/1000)}s)`, 'alert');
            } else if (faces.length >= 1) {
                // Single face detected - good
                this.faceAbsentStartTime = null;
                this.lastFaceTime = currentTime;
                
                // Check focus/gaze direction
                const face = faces[0];
                this.checkFocusState(faces);
                
                this.updateStatus('faceStatus', `Face detected (${Math.round(face.confidence * 100)}%)`, 'success');
                
                // Draw face rectangle
                this.drawFaceRectangle(face);
                
            } else {
                // Multiple faces detected
                this.triggerViolation('multiple_faces', `${faces.length} faces detected in frame`, 'high');
                this.updateStatus('faceStatus', `${faces.length} faces detected`, 'alert');
                
                // Draw all face rectangles
                faces.forEach(face => this.drawFaceRectangle(face));
            }
            
        } catch (error) {
            console.error('Face detection error:', error);
            this.updateStatus('faceStatus', 'Detection error', 'alert');
        }
    }
    
    checkFocusState(predictions) {
        if (!predictions || predictions.length === 0) {
            return this.handleFocusLost('No face detected');
        }

        const face = predictions[0];
        const keypoints = face.keypoints;
        
        if (!keypoints || keypoints.length === 0) {
            return this.handleFocusLost('No keypoints detected');
        }

        if (this.eyeDetectionMode) {
            return this.checkEyeFocus(keypoints);
        } else {
            return this.checkFacePositionFocus(keypoints);
        }
    }
    
    checkEyeFocus(keypoints) {
        // Get eye keypoints (MediaPipe Face Detection keypoints)
        const leftEye = this.getEyeKeypoint(keypoints, 'left');
        const rightEye = this.getEyeKeypoint(keypoints, 'right');
        
        if (!leftEye || !rightEye) {
            console.log('👁️ Eye detection: Could not find eye keypoints');
            return this.handleFocusLost('Eye keypoints not detected');
        }
        
        // Check for eye closure/drowsiness
        const eyesClosed = this.detectEyeClosure(leftEye, rightEye);
        this.updateEyeClosureHistory(eyesClosed);
        
        const isDrowsy = this.checkDrowsiness();
        if (isDrowsy) {
            this.handleDrowsinessDetected();
        }
        
        // Calculate eye center and direction
        const eyeCenter = {
            x: (leftEye.x + rightEye.x) / 2,
            y: (leftEye.y + rightEye.y) / 2
        };
        
        // Get canvas center
        const canvasRect = this.canvas.getBoundingClientRect();
        const canvasCenterX = canvasRect.width / 2;
        const canvasCenterY = canvasRect.height / 2;
        
        // Calculate eye direction relative to face
        const eyeDirectionX = eyeCenter.x - canvasCenterX;
        const eyeDirectionY = eyeCenter.y - canvasCenterY;
        
        // Normalize eye direction
        const eyeDistance = Math.sqrt(eyeDirectionX * eyeDirectionX + eyeDirectionY * eyeDirectionY);
        const normalizedX = eyeDistance > 0 ? eyeDirectionX / eyeDistance : 0;
        const normalizedY = eyeDistance > 0 ? eyeDirectionY / eyeDistance : 0;
        
        // Check if looking away based on eye direction
        const lookingAway = Math.abs(normalizedX) > this.lookingAwayThreshold || Math.abs(normalizedY) > this.lookingAwayThreshold;
        
        console.log(`👁️ Eye detection: Direction(${normalizedX.toFixed(2)}, ${normalizedY.toFixed(2)}), Looking away: ${lookingAway}, Eyes closed: ${eyesClosed}, Drowsy: ${isDrowsy}`);
        
        // Draw eye indicators with drowsiness info
        this.drawEyeIndicators(leftEye, rightEye, eyeCenter, canvasCenterX, canvasCenterY, eyesClosed, isDrowsy);
        
        if (lookingAway) {
            return this.handleFocusLost('Eye detection: looking away from screen');
        } else {
            return this.handleFocusRegained('Eye detection: focused on screen');
        }
    }
    
    checkFacePositionFocus(keypoints) {
        // Calculate face center
        const faceCenter = this.calculateFaceCenter(keypoints);
        if (!faceCenter) {
            return this.handleFocusLost('Could not calculate face center');
        }

        // Get canvas dimensions
        const canvasRect = this.canvas.getBoundingClientRect();
        const canvasCenterX = canvasRect.width / 2;
        const canvasCenterY = canvasRect.height / 2;
        
        // Calculate deviation from center as percentage
        const deviationX = Math.abs(faceCenter.x - canvasCenterX) / canvasCenterX * 100;
        const deviationY = Math.abs(faceCenter.y - canvasCenterY) / canvasCenterY * 100;
        
        console.log(`📍 Face position tracking: X=${deviationX.toFixed(1)}%, Y=${deviationY.toFixed(1)}%`);
        
        // Check if looking away (more lenient thresholds)
        const lookingAway = deviationX > 20 || deviationY > 25; // 20% horizontal, 25% vertical
        console.log(`🎯 Face position - Looking away? ${lookingAway} (X>${20}% OR Y>${25}%)`);
        
        // Draw visual indicators
        this.drawFaceCenterIndicator(faceCenter.x, faceCenter.y, canvasCenterX, canvasCenterY);
        
        if (lookingAway) {
            return this.handleFocusLost('Face position: looking away from screen');
        } else {
            return this.handleFocusRegained('Face position: focused on screen');
        }
    }
    
    getEyeKeypoint(keypoints, eye) {
        // MediaPipe Face Detection keypoint indices
        // Left eye: keypoint 0, Right eye: keypoint 1
        const eyeIndex = eye === 'left' ? 0 : 1;
        
        if (keypoints.length > eyeIndex) {
            return {
                x: keypoints[eyeIndex].x,
                y: keypoints[eyeIndex].y
            };
        }
        
        return null;
    }
    
    handleFocusLost(reason) {
        const currentTime = Date.now();
        
        if (this.focusLostStartTime === null) {
            this.focusLostStartTime = currentTime;
            const detectionType = this.eyeDetectionMode ? 'Eye detection' : 'Face position tracking';
            console.log(`🔄 ${detectionType} - focus lost timer started`);
            this.lastFocusState = false;
            return;
        }
        
        const focusLostDuration = currentTime - this.focusLostStartTime;
        const focusLostSeconds = Math.floor(focusLostDuration / 1000);
        
        if (focusLostDuration >= this.focusLostThreshold) {
            // Only trigger violation once and reset timer
            if ((currentTime - this.lastViolationTime) > this.violationThrottle) {
                this.triggerViolation('focus_lost', `${reason} for ${focusLostSeconds} seconds`);
                this.lastViolationTime = currentTime;
                console.log('🚨 Focus lost violation triggered');
                
                // Reset timer to prevent continuous violations
                this.focusLostStartTime = null;
                this.lastFocusState = false;
                return;
            }
        }
        
        // Only log every 5 seconds to reduce spam
        if (focusLostSeconds % 5 === 0) {
            const detectionType = this.eyeDetectionMode ? 'Eye detection' : 'Face position';
            console.log(`⏱️ ${detectionType} focus lost for ${focusLostSeconds}s (threshold: ${this.focusLostThreshold/1000}s)`);
        }
        
        this.lastFocusState = false;
        const statusType = this.eyeDetectionMode ? 'Eye detection' : 'Face position tracking';
        this.updateStatus(`❌ ${statusType}: ${reason}`);
    }
    
    // Drowsiness Detection Methods
    detectEyeClosure(leftEye, rightEye) {
        // Simple eye closure detection based on eye aspect ratio
        // In a real implementation, you'd use more sophisticated landmarks
        const eyeHeight = Math.abs(leftEye.y - rightEye.y);
        const eyeWidth = Math.abs(leftEye.x - rightEye.x);
        const eyeAspectRatio = eyeHeight / (eyeWidth + 1); // +1 to avoid division by zero
        
        return eyeAspectRatio < this.eyeClosedThreshold;
    }
    
    updateEyeClosureHistory(eyesClosed) {
        this.eyeClosureHistory.push(eyesClosed);
        if (this.eyeClosureHistory.length > this.eyeClosureWindowSize) {
            this.eyeClosureHistory.shift();
        }
    }
    
    checkDrowsiness() {
        if (this.eyeClosureHistory.length < this.eyeClosureWindowSize) {
            return false;
        }
        
        const closedCount = this.eyeClosureHistory.filter(closed => closed).length;
        const drowsinessRatio = closedCount / this.eyeClosureHistory.length;
        
        return drowsinessRatio >= this.drowsinessThreshold;
    }
    
    handleDrowsinessDetected() {
        const currentTime = Date.now();
        
        if (this.drowsinessStartTime === null) {
            this.drowsinessStartTime = currentTime;
            console.log('😴 Drowsiness detection started');
            this.showRealTimeAlert('😴 Drowsiness Detected', 'Candidate appears to be drowsy', 'warning');
        }
        
        const drowsinessDuration = currentTime - this.drowsinessStartTime;
        
        if (drowsinessDuration >= this.drowsinessAlertThreshold) {
            if ((currentTime - this.lastViolationTime) > this.violationThrottle) {
                this.triggerViolation('drowsiness', `Drowsiness detected for ${Math.round(drowsinessDuration/1000)} seconds`);
                this.lastViolationTime = currentTime;
                this.drowsinessStartTime = currentTime; // Reset to prevent spam
                this.showRealTimeAlert('⚠️ Prolonged Drowsiness', 'Candidate has been drowsy for extended period', 'error');
            }
        }
    }
    
    // Audio Detection Methods
    async initializeAudioDetection() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(stream);
            this.audioAnalyser = this.audioContext.createAnalyser();
            
            this.audioAnalyser.fftSize = 256;
            const bufferLength = this.audioAnalyser.frequencyBinCount;
            this.audioDataArray = new Uint8Array(bufferLength);
            
            source.connect(this.audioAnalyser);
            
            // Start audio monitoring
            this.startAudioMonitoring();
            
        } catch (error) {
            console.warn('Audio detection not available:', error);
        }
    }
    
    startAudioMonitoring() {
        const monitorAudio = () => {
            if (!this.audioAnalyser || !this.isDetecting) return;
            
            this.audioAnalyser.getByteFrequencyData(this.audioDataArray);
            
            // Calculate average volume
            const average = this.audioDataArray.reduce((sum, value) => sum + value, 0) / this.audioDataArray.length;
            
            // Detect background voices/noise
            if (average > this.backgroundNoiseThreshold) {
                this.handleBackgroundVoiceDetected(average);
            }
            
            requestAnimationFrame(monitorAudio);
        };
        
        monitorAudio();
    }
    
    handleBackgroundVoiceDetected(volume) {
        const currentTime = Date.now();
        
        if (!this.voiceDetectionActive) {
            this.voiceDetectionActive = true;
            this.lastVoiceDetectionTime = currentTime;
            console.log(`🎤 Background voice detected: ${Math.round(volume)} dB`);
            this.showRealTimeAlert('🎤 Background Voice', 'Background audio detected', 'warning');
        }
        
        // Reset voice detection after 2 seconds of silence
        setTimeout(() => {
            if (currentTime === this.lastVoiceDetectionTime) {
                this.voiceDetectionActive = false;
            }
        }, 2000);
        
        // Trigger violation for sustained background noise
        if (this.voiceDetectionActive && (currentTime - this.lastVoiceDetectionTime) > 5000) {
            if ((currentTime - this.lastViolationTime) > this.violationThrottle) {
                this.triggerViolation('background_audio', `Background audio detected: ${Math.round(volume)} dB`);
                this.lastViolationTime = currentTime;
                this.showRealTimeAlert('🚨 Sustained Background Audio', 'Continuous background noise detected', 'error');
            }
        }
    }
    
    // Real-time Alert System
    initializeAlertSystem() {
        // Create alert container if it doesn't exist
        if (!document.getElementById('alertContainer')) {
            const alertContainer = document.createElement('div');
            alertContainer.id = 'alertContainer';
            alertContainer.className = 'alert-container';
            document.body.appendChild(alertContainer);
            
            // Add alert styles
            this.addAlertStyles();
        }
    }
    
    showRealTimeAlert(title, message, type = 'info') {
        const alertContainer = document.getElementById('alertContainer');
        if (!alertContainer) return;
        
        // Remove oldest alert if we have too many
        while (alertContainer.children.length >= this.maxAlerts) {
            alertContainer.removeChild(alertContainer.firstChild);
        }
        
        const alert = document.createElement('div');
        alert.className = `real-time-alert alert-${type}`;
        alert.innerHTML = `
            <div class="alert-header">
                <strong>${title}</strong>
                <button class="alert-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
            </div>
            <div class="alert-message">${message}</div>
            <div class="alert-timestamp">${new Date().toLocaleTimeString()}</div>
        `;
        
        alertContainer.appendChild(alert);
        
        // Auto-remove after display time
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, this.alertDisplayTime);
        
        // Add to alert queue for interviewer dashboard
        this.alertQueue.push({
            title,
            message,
            type,
            timestamp: new Date().toISOString()
        });
        
        // Emit to server for real-time notifications
        if (this.socket) {
            this.socket.emit('realTimeAlert', {
                sessionId: this.sessionId,
                alert: { title, message, type, timestamp: new Date().toISOString() }
            });
        }
    }
    
    addAlertStyles() {
        if (document.getElementById('alertStyles')) return;
        
        const style = document.createElement('style');
        style.id = 'alertStyles';
        style.textContent = `
            .alert-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 350px;
            }
            
            .real-time-alert {
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                margin-bottom: 10px;
                padding: 15px;
                border-left: 4px solid #007bff;
                animation: slideIn 0.3s ease-out;
            }
            
            .alert-info { border-left-color: #007bff; }
            .alert-warning { border-left-color: #ffc107; background: #fff8e1; }
            .alert-error { border-left-color: #dc3545; background: #ffebee; }
            
            .alert-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            
            .alert-close {
                background: none;
                border: none;
                font-size: 18px;
                cursor: pointer;
                color: #666;
                padding: 0;
                width: 20px;
                height: 20px;
            }
            
            .alert-close:hover {
                color: #000;
            }
            
            .alert-message {
                font-size: 14px;
                color: #333;
                margin-bottom: 5px;
            }
            
            .alert-timestamp {
                font-size: 12px;
                color: #666;
                font-style: italic;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        
        document.head.appendChild(style);
    }
    
    handleFocusRegained(reason) {
        if (this.focusLostStartTime !== null) {
            const focusLostDuration = Date.now() - this.focusLostStartTime;
            const focusLostSeconds = Math.floor(focusLostDuration / 1000);
            const detectionType = this.eyeDetectionMode ? 'Eye detection' : 'Face position';
            console.log(`✅ ${detectionType} focus regained after ${focusLostSeconds}s`);
            this.focusLostStartTime = null;
        }
        
        this.lastFocusState = true;
        const statusType = this.eyeDetectionMode ? 'Eye detection' : 'Face position tracking';
        this.updateStatus(`✅ ${statusType}: ${reason}`);
    }
    
    getEyeCenter(landmarks, eyeIndices) {
        if (!landmarks || landmarks.length === 0) return null;
        
        let sumX = 0, sumY = 0, count = 0;
        
        // MediaPipe landmarks are in array format, not indexed by number
        landmarks.forEach((landmark, index) => {
            if (eyeIndices.includes(index)) {
                sumX += landmark.x;
                sumY += landmark.y;
                count++;
            }
        });
        
        if (count === 0) return null;
        
        return {
            x: sumX / count,
            y: sumY / count
        };
    }
    
    drawEyeIndicators(leftEye, rightEye, eyeCenter, canvasCenterX, canvasCenterY, eyesClosed = false, isDrowsy = false) {
        if (!this.ctx) return;
        
        // Choose colors based on eye state
        const eyeColor = eyesClosed ? '#ff6b6b' : '#00ff00';
        const centerColor = isDrowsy ? '#ff9800' : '#0088ff';
        
        // Draw left eye
        this.ctx.fillStyle = eyeColor;
        this.ctx.beginPath();
        this.ctx.arc(leftEye.x, leftEye.y, eyesClosed ? 6 : 4, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw right eye
        this.ctx.fillStyle = eyeColor;
        this.ctx.beginPath();
        this.ctx.arc(rightEye.x, rightEye.y, eyesClosed ? 6 : 4, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw eye center
        this.ctx.fillStyle = centerColor;
        this.ctx.beginPath();
        this.ctx.arc(eyeCenter.x, eyeCenter.y, isDrowsy ? 7 : 5, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw eye center label with status
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        const label = isDrowsy ? 'DROWSY' : eyesClosed ? 'CLOSED' : 'EYES';
        this.ctx.fillText(label, eyeCenter.x - 20, eyeCenter.y - 15);
        
        // Draw canvas center reference point
        this.ctx.fillStyle = '#ff0000';
        this.ctx.beginPath();
        this.ctx.arc(canvasCenterX, canvasCenterY, 4, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw canvas center label
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText('CENTER', canvasCenterX - 20, canvasCenterY + 20);
        
        // Draw line from eye center to canvas center
        this.ctx.strokeStyle = isDrowsy ? '#ff9800' : '#ffff00';
        this.ctx.lineWidth = isDrowsy ? 2 : 1;
        this.ctx.setLineDash(isDrowsy ? [3, 3] : [5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(eyeCenter.x, eyeCenter.y);
        this.ctx.lineTo(canvasCenterX, canvasCenterY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }
    
    drawFaceCenterIndicator(faceX, faceY, canvasCenterX, canvasCenterY) {
        if (!this.ctx) return;
        
        // Draw face center point
        this.ctx.fillStyle = '#00ff00';
        this.ctx.beginPath();
        this.ctx.arc(faceX, faceY, 6, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw face center label
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px Arial';
        this.ctx.fillText('FACE', faceX - 15, faceY - 15);
        
        // Draw canvas center reference point
        this.ctx.fillStyle = '#ff0000';
        this.ctx.beginPath();
        this.ctx.arc(canvasCenterX, canvasCenterY, 4, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Draw canvas center label
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText('CENTER', canvasCenterX - 20, canvasCenterY + 20);
        
        // Draw line from face to canvas center
        this.ctx.strokeStyle = '#ffff00';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(faceX, faceY);
        this.ctx.lineTo(canvasCenterX, canvasCenterY);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }
    
    async detectObjects() {
        try {
            const predictions = await this.cocoModel.detect(this.video);
            
            let unauthorizedDetected = false;
            const detectedItems = [];
            
            predictions.forEach(prediction => {
                const item = prediction.class.toLowerCase();
                const confidence = prediction.score;
                
                if (this.unauthorizedItems.includes(item) && confidence > 0.6) {
                    unauthorizedDetected = true;
                    detectedItems.push({
                        item: item,
                        confidence: Math.round(confidence * 100)
                    });
                    
                    // Draw bounding box
                    // this.drawBoundingBox(prediction.bbox, item, confidence);
                    this.drawObjectRectangle(prediction, 'red');

                }
            });
            
            if (unauthorizedDetected) {
                const itemList = detectedItems.map(d => `${d.item} (${d.confidence}%)`).join(', ');
                this.triggerViolation('unauthorized_item', `Detected: ${itemList}`, 'high');
                this.updateStatus('objectStatus', `Unauthorized items: ${itemList}`, 'alert');
                this.showRealTimeAlert(' Unauthorized Item Detected', `Found: ${itemList}`, 'error');
            } else {
                this.updateStatus('objectStatus', 'No unauthorized items detected', 'success');
            }
            
        } catch (error) {
            console.error('Object detection error:', error);
            this.updateStatus('objectStatus', 'Object detection error', 'alert');
        }
    }
    
    drawFaceRectangle(face) {
        this.ctx.strokeStyle = '#2ed573';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(face.x, face.y, face.width, face.height);
        
        // Draw confidence score
        if (face.confidence) {
            this.ctx.fillStyle = '#2ed573';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.fillText(`Face: ${Math.round(face.confidence * 100)}%`, face.x, face.y - 5);
        }
        
        // Draw landmarks if available
        if (face.landmarks) {
            this.ctx.fillStyle = '#2ed573';
            Object.entries(face.landmarks).forEach(([key, point]) => {
                if (key !== 'gazeDirection' && point.x && point.y) {
                    this.ctx.beginPath();
                    this.ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
                    this.ctx.fill();
                }
            });
            
            // Draw gaze direction indicator
            if (face.landmarks.gazeDirection) {
                const centerX = face.x + face.width / 2;
                const centerY = face.y + face.height / 2;
                const gazeX = face.landmarks.gazeDirection.x;
                const gazeY = face.landmarks.gazeDirection.y;
                
                this.ctx.strokeStyle = '#ff6b6b';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(centerX, centerY);
                this.ctx.lineTo(centerX + gazeX * 3, centerY + gazeY * 3);
                this.ctx.stroke();
            }
        }
    }
    
    drawObjectRectangle(prediction, color = 'blue') {
        const [x, y, width, height] = prediction.bbox;
        
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, width, height);
        
        // Draw label with background
        const label = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
        this.ctx.font = 'bold 14px Arial';
        const textMetrics = this.ctx.measureText(label);
        
        // Draw background rectangle for text
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y > 25 ? y - 25 : y + height, textMetrics.width + 10, 20);
        
        // Draw text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(label, x + 5, y > 25 ? y - 10 : y + height + 15);
    }
    
    triggerViolation(type, description, severity = 'medium') {
        if (this.debugMode) {
            console.log(`🚨 VIOLATION: ${type} - ${description}`);
        }
        
        // Update local violation count FIRST
        if (!this.violations[type]) {
            this.violations[type] = 0;
        }
        this.violations[type]++;
        
        // Update UI counter immediately
        this.updateViolationCounter(type);
        
        // Emit to server
        if (this.socket) {
            this.socket.emit('detection-event', {
                sessionId: this.sessionId,
                eventType: type,
                description,
                severity
            });
        }
        
        // Trigger callback if provided
        if (this.onViolation) {
            this.onViolation({
                type,
                description,
                severity,
                timestamp: new Date()
            });
        }
    }
    
    updateStatus(elementId, text, status) {
        const element = document.getElementById(elementId);
        if (element) {
            element.className = `status-item ${status}`;
            const textElement = element.querySelector('.status-value');
            if (textElement) {
                textElement.textContent = text;
            }
        }
    }
    
    updateViolationCounter(violationType) {
        const counterMap = {
            'focus_lost': 'focusLostCount',
            'face_absent': 'faceAbsentCount',
            'multiple_faces': 'multipleFacesCount',
            'unauthorized_item': 'unauthorizedItemsCount'
        };
        
        const counterId = counterMap[violationType];
        if (counterId) {
            const element = document.getElementById(counterId);
            if (element) {
                const count = this.violations[violationType] || 0;
                element.textContent = count;
                console.log(`✅ Updated ${violationType} counter to ${count}`);
            } else {
                console.error(`❌ Counter element not found: ${counterId}`);
            }
        } else {
            console.error(`❌ No counter mapping for violation type: ${violationType}`);
        }
    }
    
    updateDetectionUI() {
        // Update general detection status
        if (this.faceCount === 0) {
            this.updateStatus('faceStatus', 'No face detected', 'alert');
        } else if (this.faceCount === 1) {
            this.updateStatus('faceStatus', 'Face detected', 'success');
        } else {
            this.updateStatus('faceStatus', `${this.faceCount} faces detected`, 'alert');
        }
        
        // Update focus status
        if (this.isLookingAtScreen) {
            this.updateStatus('focusStatus', 'Focused on screen', 'success');
        } else {
            this.updateStatus('focusStatus', 'Looking away', 'warning');
        }
    }
    
    getViolationSummary() {
        return {
            focusLost: this.violations.focus_lost || 0,
            faceAbsent: this.violations.face_absent || 0,
            multipleFaces: this.violations.multiple_faces || 0,
            unauthorizedItems: this.violations.unauthorized_item || 0
        };
    }
}

// Export for use in main app
window.DetectionSystem = DetectionSystem;
