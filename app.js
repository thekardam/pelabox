const NodeMediaServer = require('node-media-server');
const express = require('express');
const { spawn } = require('child_process');
const os = require('os');

const app = express();
const port = 3000;

const nmsConfig = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: '*'
  }
};

const nms = new NodeMediaServer(nmsConfig);
nms.run();

app.use(express.static('public'));
app.use(express.json());

let ffmpegProcess = null;
let currentStreamConfig = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function startFFmpegProcess(rtmpUrl, srtUrl, bitrate) {
    
    
        ffmpegProcess = spawn('/root/ffmpeg/ffmpeg', [
            '-i', rtmpUrl,
            '-c:v', 'libx265',
            '-b:v', `${bitrate}k`,
            '-g', '24',
            '-c:a', 'copy',
            '-preset', 'fast',
            '-f', 'mpegts',
            `${srtUrl}?streamid=live/stream/beliebigerName`
        ]);
    
    
    
    

    ffmpegProcess.stderr.on('data', (data) => {
        console.log(`FFmpeg: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        
        if (currentStreamConfig && code !== 0 && restartAttempts < MAX_RESTART_ATTEMPTS) {
            console.log(`Restarting FFmpeg in 3 seconds... (Attempt ${restartAttempts + 1}/${MAX_RESTART_ATTEMPTS})`);
            setTimeout(() => {
                restartAttempts++;
                startFFmpegProcess(currentStreamConfig.rtmpUrl, currentStreamConfig.srtUrl, currentStreamConfig.bitrate);
            }, 3000);
        } else if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
            console.log('Max restart attempts reached. Stopping stream.');
            ffmpegProcess = null;
            currentStreamConfig = null;
            restartAttempts = 0;
        } else {
            ffmpegProcess = null;
            currentStreamConfig = null;
            restartAttempts = 0;
        }
    });
}

app.get('/local-ip', (req, res) => {
    res.json({ ip: getLocalIP() });
});

app.post('/start-stream', (req, res) => {
    const { srtUrl, bitrate } = req.body;
    const localIP = getLocalIP();
    const rtmpUrl = `rtmp://${localIP}:1935/live/test`;
    
    if (ffmpegProcess) {
        res.status(400).json({ error: 'Stream already running' });
        return;
    }

    try {
        currentStreamConfig = { rtmpUrl, srtUrl, bitrate };
        restartAttempts = 0;
        startFFmpegProcess(rtmpUrl, srtUrl, bitrate);
        res.json({ success: true, message: 'Stream started' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start stream' });
    }
});

app.post('/stop-stream', (req, res) => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
        ffmpegProcess = null;
        currentStreamConfig = null;
        restartAttempts = 0;
        res.json({ success: true, message: 'Stream stopped' });
    } else {
        res.status(400).json({ error: 'No stream running' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`RTMP server running at rtmp://localhost:1935`);
});
