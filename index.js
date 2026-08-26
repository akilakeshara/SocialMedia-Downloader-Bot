const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fsPromises = fs.promises;

// Catch unhandled errors so the bot doesn't crash completely
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// A wrapper for spawn to return a promise (Replaces exec to prevent command injection)
function spawnAsync(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, options);
        let stdout = '';
        let stderr = '';

        if (proc.stdout) {
            proc.stdout.on('data', (data) => { stdout += data.toString(); });
        }
        
        if (proc.stderr) {
            proc.stderr.on('data', (data) => { stderr += data.toString(); });
        }

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Command failed with code ${code}\nStderr: ${stderr}`));
            } else {
                resolve({ stdout, stderr });
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

const TEMP_DIR = path.join(__dirname, 'temp');

// Async temp directory setup
async function ensureTempDir() {
    try {
        await fsPromises.access(TEMP_DIR);
    } catch {
        await fsPromises.mkdir(TEMP_DIR);
    }
    
    // Cleanup any orphaned files from previous crashes asynchronously
    try {
        const files = await fsPromises.readdir(TEMP_DIR);
        for (const file of files) {
            await fsPromises.unlink(path.join(TEMP_DIR, file)).catch(() => {});
        }
        console.log(`Cleaned up ${files.length} orphaned temp files.`);
    } catch (err) {
        console.error('Error cleaning up temp directory:', err);
    }
}
ensureTempDir();

// Regex to detect popular social media URLs (optional https://)
const URL_REGEX = /((?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9-]+\.)*(?:tiktok\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)[^\s]+)/g;

// Concurrency Queue System
const MAX_CONCURRENT_TASKS = 3;
let activeTasks = 0;
const queue = [];

async function processQueue() {
    if (activeTasks >= MAX_CONCURRENT_TASKS || queue.length === 0) return;
    activeTasks++;

    const task = queue.shift();
    try {
        await task();
    } catch (err) {
        console.error('Queue processing error:', err);
    } finally {
        activeTasks--;
        processQueue(); // Trigger next in queue if any
    }
    processQueue(); // Trigger parallel if slots available
}

// Rate Limiting System
const rateLimits = new Map();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

function checkRateLimit(userId) {
    const now = Date.now();
    if (!rateLimits.has(userId)) {
        rateLimits.set(userId, { count: 1, firstRequestTime: now });
        return true;
    }

    const userData = rateLimits.get(userId);
    if (now - userData.firstRequestTime > RATE_LIMIT_WINDOW_MS) {
        // Reset window
        rateLimits.set(userId, { count: 1, firstRequestTime: now });
        return true;
    }

    if (userData.count >= RATE_LIMIT_MAX) {
        return false;
    }

    userData.count++;
    return true;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('Scan the QR code below to log in:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Bot is ready and connected to WhatsApp!');
});

client.on('message', async (msg) => {
    if (!msg.body) return;

    // Process all URLs found in the message
    const urls = msg.body.match(URL_REGEX);
    if (!urls || urls.length === 0) return;
    
    console.log(`Incoming message with ${urls.length} URL(s) from ${msg.from}`);

    if (!checkRateLimit(msg.from)) {
        await msg.reply('⚠️ You are sending too many requests. Please wait a minute and try again.');
        return;
    }

    // Acknowledge receipt once
    await msg.reply(`⏳ Added ${urls.length} link(s) to the queue. Please wait...`);

    // Iterate over all URLs
    for (let targetUrl of urls) {
        // Strip trailing punctuation often added by users (like dots or commas)
        targetUrl = targetUrl.replace(/[.,!?;:]$/, '');
        // Ensure https:// is present
        if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        queue.push(async () => {
            const uuid = crypto.randomUUID();
            const rawOutputTemplate = path.join(TEMP_DIR, `${uuid}_raw.%(ext)s`);
            const finalOutputPath = path.join(TEMP_DIR, `${uuid}_final.mp4`);
            let actualRawPath = null;

            try {
                console.log(`Downloading: ${targetUrl}`);
                let downloadedViaApi = false;

                // TikTok Custom Fallback via TikWM API to bypass Datacenter IP Blocks
                if (targetUrl.includes('tiktok.com')) {
                    console.log('Detected TikTok link, attempting download via TikWM API...');
                    try {
                        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}`;
                        const apiResponse = await fetch(apiUrl).then(res => res.json());
                        if (apiResponse.code === 0 && apiResponse.data && apiResponse.data.play) {
                            const playUrl = apiResponse.data.play;
                            const apiOutputPath = path.join(TEMP_DIR, `${uuid}_raw.mp4`);
                            await spawnAsync('curl', ['-s', '-L', playUrl, '-o', apiOutputPath]);
                            downloadedViaApi = true;
                            console.log('Successfully downloaded TikTok video via API');
                        } else {
                            console.log('TikWM API failed, falling back to yt-dlp...');
                        }
                    } catch (apiErr) {
                        console.error('TikWM API error:', apiErr.message);
                    }
                }
                
                if (!downloadedViaApi) {
                    // Safe arguments array, prevents command injection. Also enforces 50MB filesize limit.
                    const ytdlpArgs = [
                        '--no-playlist',
                        '-S', 'res:1080',
                        '-f', 'bestvideo+bestaudio/best',
                        '--merge-output-format', 'mp4',
                        '--max-filesize', '50M',
                        '-o', rawOutputTemplate
                    ];

                    // Add cookies if available
                    const cookiesPath = path.join(__dirname, 'cookies.txt');
                    try {
                        await fsPromises.access(cookiesPath);
                        ytdlpArgs.push('--cookies', cookiesPath);
                        console.log('Using cookies.txt for download');
                    } catch {
                        // cookies.txt not found, proceed without it
                    }
                    
                    ytdlpArgs.push(targetUrl);
                    
                    try {
                        await spawnAsync('yt-dlp', ytdlpArgs);
                    } catch (dlErr) {
                        if (dlErr.message && dlErr.message.includes('File is larger than max-filesize')) {
                            await client.sendMessage(msg.from, `❌ The video at ${targetUrl} is larger than 50MB and cannot be downloaded.`);
                            return;
                        }
                        throw dlErr;
                    }
                }

                const filesInTemp = await fsPromises.readdir(TEMP_DIR);
                const downloadedFile = filesInTemp.find(f => f.startsWith(`${uuid}_raw.`));

                if (!downloadedFile) {
                    throw new Error("File not found after yt-dlp execution");
                }

                actualRawPath = path.join(TEMP_DIR, downloadedFile);
                let mediaPath = actualRawPath;

                // Check the codec
                const ffprobeArgs = [
                    '-v', 'error',
                    '-show_entries', 'stream=codec_name',
                    '-of', 'default=noprint_wrappers=1:nokey=1',
                    actualRawPath
                ];
                const { stdout: codecOutput } = await spawnAsync('ffprobe', ffprobeArgs);
                
                const codecs = codecOutput.trim().split('\n');

                if (!codecs.includes('h264')) {
                    console.log(`Codec is ${codecs[0] || 'unknown'}. Transcoding to H.264...`);
                    const ffmpegArgs = [
                        '-i', actualRawPath,
                        '-c:v', 'libx264',
                        '-preset', 'ultrafast',
                        '-crf', '23',
                        '-threads', '1', // Reduced thread usage to avoid CPU spikes during concurrent processing
                        '-c:a', 'copy',
                        '-y',
                        finalOutputPath
                    ];
                    await spawnAsync('ffmpeg', ffmpegArgs);
                    mediaPath = finalOutputPath;
                } else {
                    console.log('Video is already H.264 compatible.');
                }

                const media = MessageMedia.fromFilePath(mediaPath);

                try {
                    await client.sendMessage(msg.from, media, {
                        caption: 'Here is your video! 🎬 - Downloaded via Zentak Bot',
                        sendMediaAsHd: true
                    });
                    console.log(`Successfully sent video to ${msg.from}`);
                } catch (sendError) {
                    console.error('Failed to send as video. Attempting Document fallback...', sendError.message);
                    await client.sendMessage(msg.from, media, {
                        caption: 'Here is your video (sent as document due to size/format). 🎬',
                        sendMediaAsDocument: true
                    });
                }

            } catch (error) {
                console.error(`Process error for ${targetUrl}:`, error.message);
                await client.sendMessage(msg.from, `❌ Sorry, I couldn't download the video from: ${targetUrl}. It might be private or unsupported.`);
            } finally {
                // Bulletproof cleanup: delete ANY file that starts with this UUID asynchronously
                try {
                    const filesToClean = await fsPromises.readdir(TEMP_DIR);
                    for (const file of filesToClean) {
                        if (file.startsWith(uuid)) {
                            await fsPromises.unlink(path.join(TEMP_DIR, file)).catch(() => {});
                            console.log(`Cleaned up: ${file}`);
                        }
                    }
                } catch (cleanupErr) {
                    console.error('Error during cleanup:', cleanupErr);
                }
            }
        });
    }

    processQueue();
});

client.initialize();