# ReelPilot - Premium Instagram Reel Scheduler 🚀

ReelPilot is a production-grade, self-hosted SaaS application that automatically syncs and schedules Instagram Reels straight from your Google Drive folders. It utilizes the official Meta Graph API to perform direct, container-based uploads without requiring Instagram login or Facebook OAuth in-app.

Designed for creators, agencies, and power users, ReelPilot runs on a secure full-stack Express + React architecture that prioritizes credential security, zero third-party dependency creep, and 100% manual configurability.

---

## Key Features

- **Google Drive Sync Pipeline**: Integrates native Google Drive OAuth. Connect your account and pick any folder. It scans and auto-couples matching video (`.mp4`) and description (`.txt`) file pairs.
- **Official Meta Ingress**: Dedicated Settings console for entering Meta credentials manually. Includes connection testing, 60-day token exchanging, and raw Meta error auditing.
- **Drag-and-Drop Calendar**: High-performance interactive visual calendar. Plan, reschedule, and examine status pipelines in Month, Week, or Day grids. Supports full HTML5 Drag-and-Drop.
- **Secure Background Worker**: An automated server process that polls every 60 seconds to process pending queues, downloads/streams videos via our signature cryptographic proxy, handles API handshakes, and logs events with standard retry capabilities.
- **Audit Logging Dashboard**: Deep execution metrics displaying raw JSON API requests, server responses, HTTP status codes, and exact Meta/Google stack traces.
- **Bulletproof Security**: Encrypts all Meta keys and access tokens on disk using robust, hardware-supported AES-256-CBC encryption before storage. Secrets are never exposed to the client.

---

## Manual Credentials Setup

### 1. Google OAuth Credentials
In AI Studio, the application automatically requests and configures the necessary Google Drive readonly scopes (`https://www.googleapis.com/auth/drive.readonly`). The environment automatically injects `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into your server runtime.

### 2. Meta Developers App
To pilot reels to Instagram, you must manual configure a Meta Developer App. Follow these steps:
1. Go to the [Meta for Developers Portal](https://developers.facebook.com/) and register a new app. Select the **Business** app type.
2. In the App Dashboard, add the **Instagram Graph API** product.
3. Link your **Instagram Business Account** to a Facebook Page that you administer.
4. Using the **Graph API Explorer** tool, choose your App and generate a **User Access Token** with these exact scopes:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
5. Exchange this token for a long-lived page token or system user token, which remains valid for 60 days.

---

## Step-by-Step Pilot Guide

### Step 1: Connect your Google Drive
On the login screen, click **Connect Google Drive**. Once authenticated, navigate to the **Drive Sync** tab. select your preferred target folder from the dropdown, and click **Connect Folder**. The pipeline immediately scans the directory for files and pairs them up:
```text
/Reels/
├── summer_promo.mp4
├── summer_promo.txt       <-- Caption auto-paired by matching base name
├── travel_vlog.mov
└── travel_vlog.txt        <-- Caption auto-paired by matching base name
```

### Step 2: Configure Meta Settings
Navigate to the **Meta Settings** tab and fill in your official IDs:
- **Meta App ID** & **Meta App Secret**
- **Long-lived Access Token**
- **Instagram Business Account ID**
- **Facebook Page ID**
- **Graph API Version** (e.g. `v20.0`)

Click **Save Settings**, then click **Verify Connection**. ReelPilot will execute a real-time call to the Meta Graph API. Upon success, it will display your Instagram handle and profile picture.

### Step 3: Schedule your first Reel
Go to the **Dashboard** and use the **Pilot a New Reel** form:
1. Select your target synchronized video asset from the dropdown (the custom caption text will load automatically from your Drive `.txt` file!).
2. Choose your preferred Launch Date and Time.
3. Select your Launch Recurrence (Single, Daily, Weekly, Monthly loops).
4. Click **Launch and Schedule Reel**.

### Step 4: Reschedule on the Calendar
If you need to change a post date, navigate to the **Calendar View**. Simply drag any scheduled blue block and drop it into another day cell. ReelPilot immediately recalculates the timestamp in background queues!

---

## Local Development & Compilation

To launch ReelPilot locally, ensure you have Node.js 18+ installed.

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Duplicate `.env.example` to `.env` and fill in the parameters:
   ```env
   APP_URL="http://localhost:3000"
   GOOGLE_CLIENT_ID="your_google_client_id"
   GOOGLE_CLIENT_SECRET="your_google_client_secret"
   ENCRYPTION_SECRET="choose_a_robust_32_character_string"
   ```

3. **Run Dev Server**:
   ```bash
   npm run dev
   ```

4. **Production Compilation**:
   Build the production static assets and compile the TypeScript backend server into a single standalone ESBuild bundle:
   ```bash
   npm run build
   ```

5. **Start Production Instance**:
   ```bash
   npm run start
   ```

---

## Production Deployment Guide

### Deployment via Docker (Recommended)

ReelPilot is fully compatible with standard container systems (Cloud Run, AWS ECS, VPS, Kubernetes). We provide a lightweight, multi-stage production Docker build.

#### 1. Generate `Dockerfile`
Create a `Dockerfile` in the root folder with the content provided below.

#### 2. Build the Docker Image
```bash
docker build -t reelpilot:latest .
```

#### 3. Run the Container
Expose port `3000` and pass in your secure environment variables:
```bash
docker run -d \
  -p 3000:3000 \
  -e APP_URL="https://your-domain.com" \
  -e GOOGLE_CLIENT_ID="your_google_id" \
  -e GOOGLE_CLIENT_SECRET="your_google_secret" \
  -e ENCRYPTION_SECRET="your_cryptographic_salt" \
  --name reelpilot-app \
  reelpilot:latest
```

---

## Technical Architecture & Ingress Flow

```text
Google Drive Folder -> Synchronizes Videos & Captions -> Encrypted SQLite/JSON State File
                                                                 │
                                                                 ▼
Background Scheduler (Interval) <- Triggers Due Items every 60s
│
├── 1. Refresh Google OAuth Tokens
├── 2. Generate cryptographically signed video proxy URL
├── 3. POST /media (creates container) -> Meta Ingress downloads via Stream Proxy
├── 4. Polling GET /container_id until status_code === 'FINISHED'
├── 5. POST /media_publish (makes Reel live)
└── 6. Updates Database & Writes Audit Logs
```
