# 📱 Personal WhatsApp Message Scheduler

A lightweight, reliable, self-hosted personal WhatsApp message scheduler built with **Node.js**, **Express**, **whatsapp-web.js**, and an embedded **SQLite** database with Write-Ahead Logging (WAL). Features a password-protected web dashboard, timezone-accurate scheduling in `Asia/Karachi` (PKT, UTC+5), and transactional job claiming to prevent duplicate message execution.

Designed for approximately **3–7 personal daily messages** (e.g., reminders to family, personal alerts, or scheduled greetings) without paying for third-party messaging providers or using Meta Cloud API.

---

## ⚠️ WhatsApp Automation & Account Risk Disclosure

> [!CAUTION]
> **Account Ban Risk Warning:**
> `whatsapp-web.js` operates by automating WhatsApp Web through a headless Chromium browser. This is an **unofficial** automation method not endorsed by Meta.
> - **Strict Volume Limits:** This scheduler is strictly intended for personal messaging (**3–7 messages per day**).
> - **Never Use for Bulk / Marketing:** Sending marketing broadcasts, mass unsolicited messages, or rapid-fire text bursts will trigger WhatsApp anti-spam heuristics and result in permanent phone number suspension.
> - **Human-like Delays:** The scheduler enforces deliberate delays between messages to prevent spam detection.

---

## ☁️ Critical Reality Check: Render Free & Ephemeral Hosting Limitations

> [!WARNING]
> **Do NOT deploy this scheduler on Render Free tier expecting reliable background deliveries!**

### 1. Inactivity Sleep (Spin-Down)
- Render Free web services automatically **spin down (sleep) after 15 minutes** of no incoming HTTP traffic.
- When the container sleeps, the Node.js process ceases execution, the Chromium browser process is killed, the 15-second scheduler loop halts, and the WhatsApp WebSocket connection is terminated.
- **Messages scheduled during sleep will NOT be sent on time.**

### 2. Ephemeral Storage (Session Loss)
- Render Free does not offer persistent disk storage. Every restart or redeployment spins up a fresh container with an empty filesystem.
- Local SQLite database files (`scheduler.db`) and WhatsApp authentication session tokens (`LocalAuth`) are permanently wiped.
- You would be forced to scan a new QR code on every server restart.

### Recommended Always-On Hosting Alternatives
To keep your laptop switched off and have messages dispatch 24/7 on schedule, deploy to:
1. **Low-Cost VPS ($3–$5/mo):** Hetzner Cloud, DigitalOcean Droplet, Linode, or Vultr.
2. **Oracle Cloud Free Tier VM:** 2 always-on AMD/ARM Compute instances with persistent storage at zero cost.
3. **PaaS with Persistent Volumes:** Fly.io (with mounted volume), Railway (with volume), or Render Paid Tier (Starter with persistent disk).
4. **Home Server:** A Raspberry Pi or old laptop connected to home Wi-Fi running Docker.

---

## 🏗️ Architecture Overview

```
                      +---------------------------------------+
                      |       Web Browser (User / Phone)      |
                      +-------------------+-------------------+
                                          | HTTP (Port 3000)
                                          v
+-----------------------------------------------------------------------------------+
| Node.js / Express Server                                                          |
|                                                                                   |
|  +--------------------+    +--------------------+    +-------------------------+  |
|  | Password Auth Gate | -> | Express Dashboard  | -> | REST API (/api/*)       |  |
|  +--------------------+    +--------------------+    +------------+------------+  |
|                                                                   |               |
|                                    +------------------------------+               |
|                                    v                                              |
|  +-------------------------------------------------------------+                  |
|  | SQLite Database (WAL Mode) - data/scheduler.db               |                  |
|  | - Messages Table: recipient, message, scheduled_at_utc,     |                  |
|  |   status, whatsapp_message_id, created_at, updated_at       |                  |
|  +------------------------------+------------------------------+                  |
|                                 ^                                                 |
|                                 | Transactional Job Claiming                      |
|                                 v (BEGIN IMMEDIATE)                               |
|  +-------------------------------------------------------------+                  |
|  | Background Scheduler Engine (Checks every 15 seconds)       |                  |
|  | - Single sender concurrency lock                            |                  |
|  | - 15-minute downtime SLA check                              |                  |
|  | - Crash & reboot recovery                                   |                  |
|  +------------------------------+------------------------------+                  |
|                                 |                                                 |
|                                 v Dispatches when Ready                           |
|  +-------------------------------------------------------------+                  |
|  | WhatsApp Web Client Manager (whatsapp-web.js + Chromium)    |                  |
|  | - LocalAuth persistent session (data/wwebjs_auth)           |                  |
|  | - RemoteAuth MongoDB/S3 adapter support                     |                  |
|  | - Timeout-guarded delivery & uncertain status tracking      |                  |
|  +-------------------------------------------------------------+                  |
+-----------------------------------------------------------------------------------+
```

### Key Architectural Safeguards
1. **Transactional Job Claiming:** Uses SQLite `BEGIN IMMEDIATE` transactions to atomically select and mark due messages as `processing`. Prevents duplicate job execution even if multiple loops or threads poll simultaneously.
2. **Asia/Karachi Timezone Handling:** User input (`YYYY-MM-DD` and `HH:mm`) and dashboard displays are strictly in `Asia/Karachi` (PKT, UTC+5). Storage in SQLite is strictly normalized UTC ISO-8601 timestamps.
3. **Downtime SLA Recovery:** If the server was turned off or crashed:
   - Messages due up to **15 minutes late** are sent immediately upon recovery.
   - Messages overdue by **more than 15 minutes** are flagged as `missed` for manual review to avoid sending contextually stale messages (e.g. "Good morning!" sent at 11:00 PM).
4. **Uncertain Send Classification:** If WhatsApp client times out or connection drops during dispatch, the job is marked `uncertain` rather than blindly retried, eliminating double-sends.
5. **Persistent Authentication:** WhatsApp browser session tokens reside in `data/wwebjs_auth` via `LocalAuth`. Once scanned, reboots do not require re-scanning.

---

## 📋 Requirements Compliance Matrix

| Requirement | Implementation Details | Status |
|---|---|---|
| **1. Link via QR after login** | QR code is generated by WhatsApp client and displayed strictly inside authenticated dashboard. | ✅ Passed |
| **2. CRUD operations** | Create, view, edit pending, cancel pending, reschedule, and delete message records. | ✅ Passed |
| **3. Input fields** | Recipient number, message body (with character counter), date picker, time picker. | ✅ Passed |
| **4. International numbers** | Accepts international format (e.g. `923001234567`, `+92...`, `0300...`). Converts to JID `923001234567@c.us`. | ✅ Passed |
| **5. Asia/Karachi timezone** | Direct PKT (UTC+5) conversion; displays human-readable Karachi time alongside UTC timestamps. | ✅ Passed |
| **6. Server execution** | Persistent background engine runs 24/7 on the server independent of client browser state. | ✅ Passed |
| **7. Persistent storage & auth** | SQLite with WAL mode (`data/scheduler.db`) and `LocalAuth` (`data/wwebjs_auth`). RemoteAuth supported. | ✅ Passed |
| **8. 15-second check & ready gate** | Scheduler ticks every 15s; dispatches ONLY if client reports `READY`. Single active sender lock. | ✅ Passed |
| **9. Status tracking** | Records `pending`, `processing`, `sent`, `failed`, `cancelled`, `uncertain`, `missed`, and WhatsApp message ID. | ✅ Passed |
| **10. Transactional job claiming** | Atomic `BEGIN IMMEDIATE` query prevents duplicates. Uncertain sends flagged for manual inspection. | ✅ Passed |
| **11. Downtime recovery** | <=15m late messages dispatched; >15m late messages marked `missed`. Crash recovery on boot. | ✅ Passed |
| **12. Connection status & QR** | Real-time connection badge (`READY`, `QR_READY`, `DISCONNECTED`) with 1-click reconnect. | ✅ Passed |
| **13. Privacy & credential safety** | Strict `.gitignore` ignores `data/`, `.env`, tokens. Numbers masked (`92300****567`) in public logs. | ✅ Passed |
| **14. Docker & beginner guide** | Multi-stage Dockerfile with Debian Chromium dependencies, `docker-compose.yml`, `.env.example`. | ✅ Passed |
| **15. Render Free limitations** | Comprehensive documentation of sleep and ephemeral disk constraints. | ✅ Passed |
| **16. Comprehensive test suite** | 12 automated unit & integration tests run via Node's native test runner (`node --test`). | ✅ Passed |

---

## 🚀 Beginner-Friendly Deployment Guide

### Option 1: Docker Compose (Recommended - Fastest & Easiest)

#### Step 1: Clone Repository
```bash
git clone https://github.com/zubairiteng/whatsapp-personal-scheduler.git
cd whatsapp-personal-scheduler
```

#### Step 2: Create Environment File
```bash
cp .env.example .env
```
Edit `.env` and set your desired password and secret:
```ini
DASHBOARD_PASSWORD=MyStrongPassword987!
SESSION_SECRET=super_secret_hex_key_32_characters_minimum
PORT=3000
```

#### Step 3: Start with Docker Compose
```bash
docker compose up -d --build
```

#### Step 4: Access Dashboard & Link WhatsApp
1. Open your browser and navigate to `http://YOUR_SERVER_IP:3000` (or `http://localhost:3000`).
2. Log in with the password configured in `DASHBOARD_PASSWORD`.
3. Within 15–30 seconds, the WhatsApp QR code will appear on the dashboard.
4. On your mobile phone, open **WhatsApp > Linked Devices > Link a Device** and scan the QR code.
5. The status badge will switch to **CONNECTED (READY)**. Your scheduler is now fully operational!

---

### Option 2: Linux VPS / Ubuntu Direct Setup (Without Docker)

#### Step 1: Install Node.js 22 & System Chromium
```bash
# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs chromium fonts-freefont-ttf dumb-init

# Verify installations
node -v
chromium --version
```

#### Step 2: Clone & Configure
```bash
git clone https://github.com/zubairiteng/whatsapp-personal-scheduler.git
cd whatsapp-personal-scheduler
cp .env.example .env
nano .env
```
Set in `.env`:
```ini
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_HEADLESS=true
DASHBOARD_PASSWORD=YourSecurePassword
SESSION_SECRET=YourSecureSecretString32Characters
```

#### Step 3: Install Production Dependencies
```bash
npm install --omit=dev
```

#### Step 4: Run with PM2 (Process Manager for 24/7 Uptime)
```bash
sudo npm install -g pm2
pm2 start src/server.js --name "whatsapp-scheduler"
pm2 save
pm2 startup
```

---

## 🧪 Automated Test Suite

The test suite uses Node.js's built-in test runner (`node:test`) and built-in SQLite (`node:sqlite`), requiring **zero external dependencies** and consuming **zero extra local disk space**:

```bash
npm test
```

### Tests Executed:
1. `tests/timezone.test.js`:
   - Karachi local time (PKT UTC+5) conversion to UTC ISO.
   - Across-day boundary conversions (e.g. midnight in Karachi = 19:00 UTC previous day).
   - Rejection of invalid calendar dates (e.g. Feb 30th) and invalid hours.
   - `isPast` utility verification.
2. `tests/phone.test.js`:
   - Pakistani international format (`923001234567`).
   - Pakistani local format conversion (`03001234567` &rarr; `923001234567`).
   - Formatting with spaces, dashes, and parentheses (`+92 (300) 123-4567`).
   - International numbers (US +1, UK +44, UAE +971).
   - JID conversion (`923001234567@c.us`).
3. `tests/job-claiming.test.js`:
   - Transactional claiming with `BEGIN IMMEDIATE`.
   - Atomic status transition from `pending` to `processing`.
   - Future jobs are not claimed.
4. `tests/downtime-recovery.test.js`:
   - Messages <= 15 minutes late after downtime claimed for delivery.
   - Messages > 15 minutes late marked as `missed` with audit explanation.
5. `tests/restart-recovery.test.js`:
   - Inspection of stranded `processing` jobs following server reboot.
   - Prevention of duplicate sending by marking within-window crash jobs as `uncertain`.
6. `tests/uncertain-send.test.js`:
   - Mock WhatsApp client simulating timeout.
   - Transition to `uncertain` status.
   - Verification that uncertain jobs are **never** resent automatically.
7. `tests/successful-send.test.js`:
   - Mock WhatsApp client returning message ID.
   - Verification of `sent` status and `whatsapp_message_id` storage.

---

## 📄 License
MIT License. Created by Zubair Ahmed. Built for personal, educational, and authorized messaging use.
