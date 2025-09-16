const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Create a directory for demo assets if it doesn't exist
const assetsDir = path.join(__dirname, 'demo-assets');
if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

// Create a simple FFmpeg command to generate a demo video
// This is a placeholder - in a real scenario, you would record actual demo footage
const ffmpegCmd = `
ffmpeg -y \
  -f lavfi -i color=c=blue:s=1280x720:d=180 \
  -vf "drawtext=text='Video Proctoring Demo':fontcolor=white:fontsize=48:box=1:boxcolor=black@0.5:boxborderw=5:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -t 10 \
  ${path.join(assetsDir, 'demo_video.mp4')}
`;

console.log("Generating demo video...");
console.log("Note: For a real demo, you should replace this with actual screen recording of the proctoring system in action.");

// Execute the FFmpeg command
exec(ffmpegCmd, (error, stdout, stderr) => {
    if (error) {
        console.error(`Error generating demo video: ${error.message}`);
        console.log("Make sure FFmpeg is installed and added to your system PATH");
        console.log("You can download FFmpeg from: https://ffmpeg.org/download.html");
        return;
    }
    console.log(`Demo video generated at: ${path.join(assetsDir, 'demo_video.mp4')}`);
    console.log("\nFor a real demo, please record a 2-3 minute video showing:");
    console.log("1. The proctoring system interface");
    console.log("2. Detection of faces and objects");
    console.log("3. Real-time alerts and notifications");
    console.log("4. The reporting interface");
});
