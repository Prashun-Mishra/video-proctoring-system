class VideoProctoringApp {
    constructor() {
        this.socket = null;
        this.sessionId = null;
        this.candidateName = '';
        this.startTime = null;
        this.detectionSystem = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.durationInterval = null;
        
        // DOM elements
        this.setupSection = document.getElementById('setupSection');
        this.interviewSection = document.getElementById('interviewSection');
        this.reportSection = document.getElementById('reportSection');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.videoElement = document.getElementById('videoElement');
        this.detectionCanvas = document.getElementById('detectionCanvas');
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.initializeSocket();
        this.detectionSystem = new DetectionSystem();
    }
    
    setupEventListeners() {
        // Start interview button
        document.getElementById('startInterviewBtn').addEventListener('click', () => {
            this.startInterview();
        });
        
        // End interview button
        document.getElementById('endInterviewBtn').addEventListener('click', () => {
            this.endInterview();
        });
        
        // Recording toggle button
        document.getElementById('toggleRecordingBtn').addEventListener('click', () => {
            this.toggleRecording();
        });
        
        // Generate report button
        document.getElementById('generateReportBtn').addEventListener('click', () => {
            this.generateReport();
        });
        
        // Download report button
        document.getElementById('downloadReportBtn').addEventListener('click', () => {
            this.downloadReport();
        });
        
        // New session button
        document.getElementById('newSessionBtn').addEventListener('click', () => {
            this.startNewSession();
        });
        
        // Enter key on candidate name input
        document.getElementById('candidateName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.startInterview();
            }
        });
    }
    
    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });
        
        this.socket.on('real-time-event', (data) => {
            this.handleRealTimeEvent(data);
            
            // Update violation counters from server data
            if (data.violationCounts) {
                this.updateViolationCountersFromServer(data.violationCounts);
            }
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
    }
    
    async startInterview() {
        const candidateNameInput = document.getElementById('candidateName');
        this.candidateName = candidateNameInput.value.trim();
        
        if (!this.candidateName) {
            alert('Please enter candidate name');
            candidateNameInput.focus();
            return;
        }
        
        try {
            this.showLoading('Initializing interview session...');
            
            // Create session
            const response = await fetch('/api/session/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    candidateName: this.candidateName
                })
            });
            
            const data = await response.json();
            this.sessionId = data.sessionId;
            
            // Join socket room
            this.socket.emit('join-session', this.sessionId);
            
            // Initialize camera
            await this.initializeCamera();
            
            // Initialize detection system
            this.detectionSystem = new DetectionSystem();
            this.detectionSystem.setSocket(this.socket, this.sessionId);
            this.detectionSystem.setViolationCallback((violation) => {
                this.handleViolation(violation);
            });
            
            // Add keyboard listener for manual focus testing
            this.setupKeyboardListeners();
            
            // Initialize detection system
            this.showLoading('Loading AI models...');
            const detectionInitialized = await this.detectionSystem.initialize(
                this.videoElement,
                this.detectionCanvas,
                this.socket,
                this.sessionId
            );
            
            if (!detectionInitialized) {
                throw new Error('Failed to initialize detection system');
            }
            
            // Start detection
            this.detectionSystem.startDetection();
            
            // Update UI
            this.showInterviewSection();
            this.startTime = new Date();
            this.startDurationTimer();
            
            this.hideLoading();
            
        } catch (error) {
            console.error('Error starting interview:', error);
            alert('Failed to start interview: ' + error.message);
            this.hideLoading();
        }
    }
    
    async initializeCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                },
                audio: true
            });
            
            this.videoElement.srcObject = stream;
            
            // Wait for video to load
            return new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    // Set canvas size to match video dimensions
                    const videoRect = this.videoElement.getBoundingClientRect();
                    this.detectionCanvas.width = this.videoElement.videoWidth;
                    this.detectionCanvas.height = this.videoElement.videoHeight;
                    
                    // Ensure canvas overlays video properly
                    this.detectionCanvas.style.width = '100%';
                    this.detectionCanvas.style.height = '100%';
                    this.detectionCanvas.style.objectFit = 'contain';
                    
                    resolve();
                };
            });
            
        } catch (error) {
            throw new Error('Camera access denied or not available');
        }
    }
    
    async endInterview() {
        if (!confirm('Are you sure you want to end the interview?')) {
            return;
        }
        
        try {
            // Stop detection
            if (this.detectionSystem) {
                this.detectionSystem.stopDetection();
            }
            
            // Stop recording if active
            if (this.isRecording) {
                this.stopRecording();
            }
            
            // Stop camera
            if (this.videoElement.srcObject) {
                const tracks = this.videoElement.srcObject.getTracks();
                tracks.forEach(track => track.stop());
            }
            
            // Stop duration timer
            if (this.durationInterval) {
                clearInterval(this.durationInterval);
            }
            
            // End session on server
            const response = await fetch('/api/session/end', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: this.sessionId
                })
            });
            
            const data = await response.json();
            console.log('Session ended:', data);
            
            // Show generate report button
            document.getElementById('generateReportBtn').classList.remove('hidden');
            document.getElementById('endInterviewBtn').style.display = 'none';
            
        } catch (error) {
            console.error('Error ending interview:', error);
            alert('Error ending interview: ' + error.message);
        }
    }
    
    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }
    
    async startRecording() {
        try {
            const stream = this.videoElement.srcObject;
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9'
            });
            
            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                this.uploadRecording();
            };
            
            this.mediaRecorder.start(1000); // Collect data every second
            this.isRecording = true;
            
            // Update UI
            const recordBtn = document.getElementById('toggleRecordingBtn');
            recordBtn.textContent = 'Stop Recording';
            recordBtn.classList.add('recording');
            
            document.getElementById('recordingIndicator').classList.remove('hidden');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Failed to start recording: ' + error.message);
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // Update UI
            const recordBtn = document.getElementById('toggleRecordingBtn');
            recordBtn.textContent = 'Start Recording';
            recordBtn.classList.remove('recording');
            
            document.getElementById('recordingIndicator').classList.add('hidden');
        }
    }
    
    async uploadRecording() {
        if (this.recordedChunks.length === 0) return;
        
        try {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const formData = new FormData();
            formData.append('video', blob, `${this.sessionId}_recording.webm`);
            formData.append('sessionId', this.sessionId);
            
            const response = await fetch('/api/upload/video', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                console.log('Video uploaded successfully');
            } else {
                console.error('Failed to upload video');
            }
            
        } catch (error) {
            console.error('Error uploading recording:', error);
        }
    }
    
    async generateReport() {
        try {
            this.showLoading('Generating proctoring report...');
            
            const response = await fetch(`/api/session/${this.sessionId}/report`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const sessionData = await response.json();
            
            if (!sessionData) {
                throw new Error('No session data received');
            }
            
            console.log('Session data received:', sessionData);
            
            this.displayReport(sessionData);
            this.showReportSection();
            this.hideLoading();
            
        } catch (error) {
            console.error('Error generating report:', error);
            alert('Failed to generate report: ' + error.message);
            this.hideLoading();
        }
    }
    
    displayReport(sessionData) {
        const reportContent = document.getElementById('reportContent');
        
        const duration = sessionData.duration || 0;
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = duration % 60;
        const durationStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        const integrityScore = sessionData.integrityScore || 0;
        const scoreColor = integrityScore >= 80 ? '#4caf50' : integrityScore >= 60 ? '#ffa726' : '#ff6b6b';
        
        reportContent.innerHTML = `
            <div class="report-header">
                <h3>Interview Proctoring Report</h3>
                <div class="report-meta">
                    <p><strong>Session ID:</strong> ${sessionData.sessionId}</p>
                    <p><strong>Candidate:</strong> ${sessionData.candidateName}</p>
                    <p><strong>Date:</strong> ${new Date(sessionData.startTime).toLocaleDateString()}</p>
                    <p><strong>Duration:</strong> ${durationStr}</p>
                </div>
            </div>
            
            <div class="integrity-score">
                <h4>Integrity Score</h4>
                <div class="score-circle" style="border-color: ${scoreColor}; color: ${scoreColor};">
                    <span class="score-value">${integrityScore}</span>
                    <span class="score-label">/ 100</span>
                </div>
                <p class="score-description">
                    ${integrityScore >= 80 ? 'Excellent integrity - No major violations detected' :
                      integrityScore >= 60 ? 'Good integrity - Minor violations detected' :
                      'Poor integrity - Multiple violations detected'}
                </p>
            </div>
            
            <div class="violations-summary">
                <h4>Violations Summary</h4>
                <div class="violations-grid">
                    <div class="violation-item">
                        <span class="violation-count">${sessionData.violations.focusLost}</span>
                        <span class="violation-label">Focus Lost</span>
                        <span class="violation-description">Looking away for >5 seconds</span>
                    </div>
                    <div class="violation-item">
                        <span class="violation-count">${sessionData.violations.faceAbsent}</span>
                        <span class="violation-label">Face Absent</span>
                        <span class="violation-description">No face detected for >10 seconds</span>
                    </div>
                    <div class="violation-item">
                        <span class="violation-count">${sessionData.violations.multipleFaces}</span>
                        <span class="violation-label">Multiple Faces</span>
                        <span class="violation-description">More than one person detected</span>
                    </div>
                    <div class="violation-item">
                        <span class="violation-count">${sessionData.violations.unauthorizedItems}</span>
                        <span class="violation-label">Unauthorized Items</span>
                        <span class="violation-description">Phone, books, notes detected</span>
                    </div>
                </div>
            </div>
            
            <div class="events-timeline">
                <h4>Event Timeline</h4>
                <div class="timeline-container">
                    ${sessionData.events && sessionData.events.length > 0 ? 
                        sessionData.events.map(event => `
                            <div class="timeline-event ${event.severity || 'medium'}">
                                <div class="event-time">${new Date(event.timestamp).toLocaleTimeString()}</div>
                                <div class="event-type">${(event.type || 'unknown').replace('_', ' ').toUpperCase()}</div>
                                <div class="event-description">${event.description || 'No description available'}</div>
                            </div>
                        `).join('') :
                        '<p class="no-events">No violations detected during the interview.</p>'
                    }
                </div>
            </div>
        `;
        
        // Add CSS for report styling
        this.addReportStyles();
        
        // Add download buttons
        this.addDownloadButtons(sessionData);
    }
    
    addDownloadButtons(sessionData) {
        const reportContent = document.getElementById('reportContent');
        const downloadSection = document.createElement('div');
        downloadSection.className = 'download-section';
        downloadSection.innerHTML = `
            <div class="download-buttons">
                <button onclick="app.downloadReportPDF()" class="download-btn pdf-btn">
                    📄 Download PDF Report
                </button>
                <button onclick="app.downloadReportCSV()" class="download-btn csv-btn">
                    📊 Download CSV Data
                </button>
                <button onclick="app.printReport()" class="download-btn print-btn">
                    🖨️ Print Report
                </button>
            </div>
        `;
        reportContent.appendChild(downloadSection);
        
        // Store session data for downloads
        this.currentSessionData = sessionData;
    }
    
    downloadReportPDF() {
        // Create printable version
        const printWindow = window.open('', '_blank');
        const reportHTML = this.generatePrintableReport(this.currentSessionData);
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Proctoring Report - ${this.currentSessionData.candidateName}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .report-header { text-align: center; margin-bottom: 30px; }
                    .score-section { text-align: center; margin: 20px 0; }
                    .violations-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
                    .violation-item { border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
                    .timeline-event { border-left: 3px solid #007bff; padding: 10px; margin: 10px 0; }
                    @media print { body { margin: 0; } }
                </style>
            </head>
            <body>
                ${reportHTML}
                <script>window.print(); window.close();</script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }
    
    downloadReportCSV() {
        const csvData = this.generateCSVReport(this.currentSessionData);
        const blob = new Blob([csvData], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proctoring-report-${this.currentSessionData.candidateName}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }
    
    printReport() {
        window.print();
    }
    
    generatePrintableReport(sessionData) {
        const duration = sessionData.duration || 0;
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = duration % 60;
        const durationStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        return `
            <div class="report-header">
                <h1>🎯 TubeDude - Video Proctoring Report</h1>
                <h2>Interview Session Analysis</h2>
                <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div class="session-info">
                <h3>Session Information</h3>
                <p><strong>Session ID:</strong> ${sessionData.sessionId}</p>
                <p><strong>Candidate Name:</strong> ${sessionData.candidateName}</p>
                <p><strong>Start Time:</strong> ${new Date(sessionData.startTime).toLocaleString()}</p>
                <p><strong>End Time:</strong> ${sessionData.endTime ? new Date(sessionData.endTime).toLocaleString() : 'N/A'}</p>
                <p><strong>Duration:</strong> ${durationStr}</p>
            </div>
            
            <div class="score-section">
                <h3>Integrity Score</h3>
                <h2 style="color: ${sessionData.integrityScore >= 80 ? '#4caf50' : sessionData.integrityScore >= 60 ? '#ffa726' : '#ff6b6b'}">
                    ${sessionData.integrityScore || 0}/100
                </h2>
                <p>${sessionData.integrityScore >= 80 ? 'Excellent Integrity' : sessionData.integrityScore >= 60 ? 'Good Integrity' : 'Needs Review'}</p>
            </div>
            
            <div class="violations-section">
                <h3>Violation Summary</h3>
                <div class="violations-grid">
                    <div class="violation-item">
                        <h4>Focus Lost</h4>
                        <p><strong>${sessionData.violations?.focusLost || 0}</strong> violations</p>
                        <p>Looking away from screen</p>
                    </div>
                    <div class="violation-item">
                        <h4>Face Absent</h4>
                        <p><strong>${sessionData.violations?.faceAbsent || 0}</strong> violations</p>
                        <p>No face detected in frame</p>
                    </div>
                    <div class="violation-item">
                        <h4>Multiple Faces</h4>
                        <p><strong>${sessionData.violations?.multipleFaces || 0}</strong> violations</p>
                        <p>More than one person detected</p>
                    </div>
                    <div class="violation-item">
                        <h4>Unauthorized Items</h4>
                        <p><strong>${sessionData.violations?.unauthorizedItems || 0}</strong> violations</p>
                        <p>Prohibited objects detected</p>
                    </div>
                </div>
            </div>
            
            <div class="timeline-section">
                <h3>Event Timeline</h3>
                ${sessionData.events && sessionData.events.length > 0 ? 
                    sessionData.events.map(event => `
                        <div class="timeline-event">
                            <strong>${new Date(event.timestamp).toLocaleString()}</strong> - 
                            ${(event.type || 'unknown').replace('_', ' ').toUpperCase()}: 
                            ${event.description || 'No description'}
                        </div>
                    `).join('') :
                    '<p>No violations detected during the interview session.</p>'
                }
            </div>
        `;
    }
    
    generateCSVReport(sessionData) {
        const duration = sessionData.duration || 0;
        const durationStr = `${Math.floor(duration / 3600)}:${Math.floor((duration % 3600) / 60)}:${duration % 60}`;
        
        let csv = 'TubeDude Video Proctoring Report\n\n';
        csv += 'Session Information\n';
        csv += 'Field,Value\n';
        csv += `Session ID,${sessionData.sessionId}\n`;
        csv += `Candidate Name,${sessionData.candidateName}\n`;
        csv += `Start Time,${new Date(sessionData.startTime).toLocaleString()}\n`;
        csv += `End Time,${sessionData.endTime ? new Date(sessionData.endTime).toLocaleString() : 'N/A'}\n`;
        csv += `Duration,${durationStr}\n`;
        csv += `Integrity Score,${sessionData.integrityScore || 0}/100\n\n`;
        
        csv += 'Violation Summary\n';
        csv += 'Violation Type,Count,Description\n';
        csv += `Focus Lost,${sessionData.violations?.focusLost || 0},Looking away from screen\n`;
        csv += `Face Absent,${sessionData.violations?.faceAbsent || 0},No face detected in frame\n`;
        csv += `Multiple Faces,${sessionData.violations?.multipleFaces || 0},More than one person detected\n`;
        csv += `Unauthorized Items,${sessionData.violations?.unauthorizedItems || 0},Prohibited objects detected\n\n`;
        
        if (sessionData.events && sessionData.events.length > 0) {
            csv += 'Event Timeline\n';
            csv += 'Timestamp,Event Type,Description,Severity\n';
            sessionData.events.forEach(event => {
                csv += `${new Date(event.timestamp).toLocaleString()},${(event.type || 'unknown').replace('_', ' ')},"${event.description || 'No description'}",${event.severity || 'medium'}\n`;
            });
        } else {
            csv += 'Event Timeline\n';
            csv += 'No violations detected during the interview session.\n';
        }
        
        return csv;
    }
    
    addReportStyles() {
        if (document.getElementById('reportStyles')) return;
        
        const style = document.createElement('style');
        style.id = 'reportStyles';
        style.textContent = `
            .report-header {
                text-align: center;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 2px solid #e9ecef;
            }
            
            .report-meta {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-top: 15px;
                text-align: left;
            }
            
            .integrity-score {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .score-circle {
                width: 120px;
                height: 120px;
                border: 8px solid;
                border-radius: 50%;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                margin: 20px auto;
                font-weight: bold;
            }
            
            .score-value {
                font-size: 2.5rem;
                line-height: 1;
            }
            
            .score-label {
                font-size: 1rem;
                opacity: 0.7;
            }
            
            .violations-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-top: 20px;
            }
            
            .violation-item {
                background: #f8f9fa;
                padding: 20px;
                border-radius: 10px;
                text-align: center;
                border-left: 4px solid #dee2e6;
            }
            
            .violation-count {
                display: block;
                font-size: 2rem;
                font-weight: bold;
                color: #333;
                margin-bottom: 8px;
            }
            
            .violation-label {
                display: block;
                font-weight: 600;
                color: #555;
                margin-bottom: 4px;
            }
            
            .violation-description {
                display: block;
                font-size: 0.9rem;
                color: #777;
            }
            
            .timeline-container {
                max-height: 300px;
                overflow-y: auto;
                margin-top: 20px;
            }
            
            .timeline-event {
                background: #f8f9fa;
                padding: 15px;
                margin-bottom: 10px;
                border-radius: 8px;
                border-left: 4px solid #dee2e6;
            }
            
            .timeline-event.high {
                border-left-color: #ff6b6b;
                background: #fff5f5;
            }
            
            .timeline-event.medium {
                border-left-color: #ffa726;
                background: #fffbf0;
            }
            
            .timeline-event.low {
                border-left-color: #42a5f5;
                background: #f0f8ff;
            }
            
            .event-time {
                font-size: 0.9rem;
                color: #666;
                margin-bottom: 5px;
            }
            
            .event-type {
                font-weight: 600;
                color: #333;
                margin-bottom: 5px;
            }
            
            .event-description {
                color: #555;
            }
        `;
        
        document.head.appendChild(style);
    }
    
    downloadReport() {
        // Generate and download PDF report
        const reportContent = document.getElementById('reportContent').innerHTML;
        const printWindow = window.open('', '_blank');
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Proctoring Report - ${this.candidateName}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    ${document.getElementById('reportStyles').textContent}
                </style>
            </head>
            <body>
                ${reportContent}
            </body>
            </html>
        `);
        
        printWindow.document.close();
        printWindow.print();
    }
    
    startNewSession() {
        // Reset application state
        this.sessionId = null;
        this.candidateName = '';
        this.startTime = null;
        
        // Reset form
        document.getElementById('candidateName').value = '';
        this.setupKeyboardListeners();
        this.resetCounters();
        
        // Clear events log
        document.getElementById('eventsContainer').innerHTML = '<p class="no-events">No events detected yet...</p>';
        
        // Show setup section
        this.showSetupSection();
    }
    
    setupKeyboardListeners() {
        document.addEventListener('keydown', (event) => {
            if (event.key.toLowerCase() === 'f' && this.detectionSystem) {
                console.log('🔥 Manual focus lost test triggered!');
                this.detectionSystem.triggerViolation('focus_lost', 'Manual test: Focus lost simulation', 'medium');
            }
        });
    }
    
    resetCounters() {
        // Reset violation counters
        document.getElementById('focusLostCount').textContent = '0';
        document.getElementById('faceAbsentCount').textContent = '0';
        document.getElementById('multipleFacesCount').textContent = '0';
        document.getElementById('unauthorizedItemsCount').textContent = '0';
        // Clear events log
        document.getElementById('eventsContainer').innerHTML = '<p class="no-events">No events detected yet...</p>';
        
        // Show setup section
        this.showSetupSection();
    }
    
    updateViolationCountersFromServer(violationCounts) {
        console.log('📊 Updating violation counters from server:', violationCounts);
        
        const focusElement = document.getElementById('focusLostCount');
        const faceElement = document.getElementById('faceAbsentCount');
        const multipleFacesElement = document.getElementById('multipleFacesCount');
        const unauthorizedElement = document.getElementById('unauthorizedItemsCount');
        
        if (focusElement) {
            focusElement.textContent = violationCounts.focusLost || 0;
            console.log('✅ Updated focusLostCount to:', violationCounts.focusLost || 0);
        }
        if (faceElement) {
            faceElement.textContent = violationCounts.faceAbsent || 0;
            console.log('✅ Updated faceAbsentCount to:', violationCounts.faceAbsent || 0);
        }
        if (multipleFacesElement) {
            multipleFacesElement.textContent = violationCounts.multipleFaces || 0;
            console.log('✅ Updated multipleFacesCount to:', violationCounts.multipleFaces || 0);
        }
        if (unauthorizedElement) {
            unauthorizedElement.textContent = violationCounts.unauthorizedItems || 0;
            console.log('✅ Updated unauthorizedItemsCount to:', violationCounts.unauthorizedItems || 0);
        }
    }
    
    handleViolation(violation) {
        console.log('🚨 Violation handled locally:', violation);
        // Local violation handling can be added here if needed
        // The violation is already sent to server via socket in DetectionSystem
    }
    
    handleRealTimeEvent(data) {
        // Add event to live events log
        this.addEventToLog(data);
        
        console.log('Real-time event received:', data);
    }
    
    addEventToLog(event) {
        const eventsContainer = document.getElementById('eventsContainer');
        
        // Remove "no events" message if present
        const noEventsMsg = eventsContainer.querySelector('.no-events');
        if (noEventsMsg) {
            noEventsMsg.remove();
        }
        
        // Create event element
        const eventElement = document.createElement('div');
        eventElement.className = `event-item ${event.severity}`;
        eventElement.innerHTML = `
            <div class="event-time">${new Date(event.timestamp).toLocaleTimeString()}</div>
            <div class="event-description">${event.description}</div>
        `;
        
        // Add to top of events container
        eventsContainer.insertBefore(eventElement, eventsContainer.firstChild);
        
        // Limit to 10 events
        const events = eventsContainer.querySelectorAll('.event-item');
        if (events.length > 10) {
            events[events.length - 1].remove();
        }
    }
    
    startDurationTimer() {
        this.durationInterval = setInterval(() => {
            if (this.startTime) {
                const now = new Date();
                const duration = Math.floor((now - this.startTime) / 1000);
                const hours = Math.floor(duration / 3600);
                const minutes = Math.floor((duration % 3600) / 60);
                const seconds = duration % 60;
                
                document.getElementById('durationDisplay').textContent = 
                    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    showSetupSection() {
        this.setupSection.classList.remove('hidden');
        this.interviewSection.classList.add('hidden');
        this.reportSection.classList.add('hidden');
    }
    
    showInterviewSection() {
        this.setupSection.classList.add('hidden');
        this.interviewSection.classList.remove('hidden');
        this.reportSection.classList.add('hidden');
        
        // Update session info
        document.getElementById('candidateNameDisplay').textContent = this.candidateName;
        document.getElementById('sessionIdDisplay').textContent = this.sessionId;
    }
    
    showReportSection() {
        this.setupSection.classList.add('hidden');
        this.interviewSection.classList.add('hidden');
        this.reportSection.classList.remove('hidden');
    }
    
    showLoading(message = 'Loading...') {
        this.loadingOverlay.classList.remove('hidden');
        this.loadingOverlay.querySelector('p').textContent = message;
    }
    
    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VideoProctoringApp();
});
