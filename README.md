# SocialMedia Downloader Bot

A powerful WhatsApp bot to download videos from popular social media platforms including Facebook, TikTok, Instagram, and YouTube. Built using `whatsapp-web.js` and `yt-dlp`.

## Features
- **Multi-Platform Support**: Automatically detects and downloads media from TikTok, Facebook, Instagram, and YouTube.
- **Custom TikTok Fallback**: Bypasses strict Datacenter/VPS IP blocks on TikTok using the TikWM API.
- **Automatic Format Conversion**: Transcodes unsupported video formats to H.264 automatically using `ffmpeg` to ensure compatibility with WhatsApp.
- **Rate Limiting**: Built-in rate limiting (3 requests per minute per user) to prevent spam and protect your accounts.
- **Concurrency Queue**: Handles multiple simultaneous download requests safely.
- **Auto-Cleanup**: Automatically cleans up temporary video files after sending.

## Prerequisites
- **Node.js** (v18 or v20 recommended)
- **ffmpeg** & **ffprobe**
- **Python 3.11** or higher
- **yt-dlp** and its dependencies (e.g., `curl-cffi`)

## Installation (Local or VPS)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/akilakeshara/SocialMedia-Downloader-Bot.git
   cd SocialMedia-Downloader-Bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Install yt-dlp & impersonation targets (Python 3.11+ required):**
   ```bash
   sudo pip3 install -U "yt-dlp[default]" curl-cffi
   ```

4. **Add Cookies (Optional but recommended for Facebook/Instagram):**
   - Export your browser cookies using an extension like "Get cookies.txt LOCALLY".
   - Save the file as `cookies.txt` in the root folder of the project.

## Usage

Start the bot normally:
```bash
node index.js
```

Or run it constantly in the background using PM2 (recommended for VPS):
```bash
pm2 start index.js --name "zentak-bot"
pm2 save
```

Scan the QR code printed in the terminal using your WhatsApp (Linked Devices) to log in. Once connected, the bot is ready to receive links.

## License
MIT License
