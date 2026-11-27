<h1 align="center">xlab-nvr</h1>

<p align="center">
  <img src="public/icon.svg" width="128" alt="xlab-nvr logo">
</p>

<p align="center"><b>A quiet home camera recorder for small servers.</b></p>

<p align="center"><a href="#install">Install</a> · <a href="#key-features">Features</a> · <a href="#connecting-go2rtc--importing-cameras">go2rtc setup</a> · <a href="#storage-layout">Storage</a></p>

Lightweight, self-hosted NVR web app & PWA with secure login, a Frigate-inspired dark UI, go2rtc low-latency streaming, 24/7 NAS segment recording, and ONVIF object-detection clip capture


[![Docker image](https://github.com/CJNG20u/xlab-nvr/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/CJNG20u/xlab-nvr/pkgs/container/xlab-nvr)

🐳 **Docker image:** `ghcr.io/cjng20u/xlab-nvr:latest` (amd64 + arm64)

```bash
docker pull ghcr.io/cjng20u/xlab-nvr:latest
```
<img width="424" height="861" alt="image" src="https://github.com/user-attachments/assets/9184ea39-06bb-4864-bbbc-1ff33bea0dda" />

## Why Xlab-nvr?

Traditional AI NVRs decode every camera stream 24/7 on the host CPU/GPU just to run frame-by-frame object detection—causing high power draw, thermal spikes, loud fan noise, and heavy disk I/O.

**Xlab-nvr** takes an edge-first, zero-transcode architecture:
- **Zero-Transcode Recording:** Uses `ffmpeg -c copy` via `go2rtc` to write continuous `.mp4` segments directly to local or NAS storage without decoding video frames on the server.
- **Hardware Edge AI via ONVIF:** Offloads person/motion detection to your cameras' built-in hardware via ONVIF PullPoint subscriptions—eliminating continuous server-side ML inference loops and CPU spikes.
- **Whisper-Quiet & Low Footprint:** Runs as a single lightweight Node.js/React container with minimal RAM usage, no `/dev/shm` frame buffers, and drastically reduced NFS/ZFS write churn.
A lightweight, self-hosted Network Video Recorder (NVR) and live camera wall built for low-resource home servers, mini PCs, and NAS hosts.

**xlab-nvr** pairs a dark, borderless live monitoring interface with [`go2rtc`](https://github.com/AlexxIT/go2rtc) for ultra-low-latency streaming, zero-transcode `ffmpeg` stream-copy recording, and camera-native ONVIF PullPoint AI event detection — all packaged in a single Docker container with local JSON configuration and SQLite indexing.

---

## Key Features

- **Low-Latency WebSocket MSE Live Grid**: Borderless multi-camera live wall with custom camera groups, stacked or grid layouts, live audio mute/unmute, and instant full-screen focus.
- **Per-Camera Operating Modes**: Independently toggle **Live Only**, **24/7 Continuous Recording**, and **ONVIF Object Detection** per camera without restarting the server. Cameras in *Live Only* mode spawn zero `ffmpeg` workers and zero ONVIF pollers.
- **Zero-Transcode 24/7 Continuous Recording**: Writes 5-minute `.mp4` segments directly via `ffmpeg -c:v copy` to local disks or NAS mounts with automatic worker recovery and negligible CPU usage.
- **ONVIF Hardware Object Detection**: Subscribes to camera-native ONVIF `PullPointSubscription` AI events (`person`, `vehicle`, `pet`, `line_crossing`, `motion`) to capture short `.mp4` clips and `.jpg` thumbnails without requiring a GPU or Coral TPU.
- **Unified Timeline Scrubbing & Multi-Camera Review**: Scrub across a 24-hour timeline per camera or across all cameras simultaneously, filter by detection label, adjust playback speed (`1x`–`8x`), and export lossless trimmed `.mp4` clips.
- **One-Click `go2rtc` Stream Import**: Automatically discovers streams from `<go2rtcUrl>/api/streams`, extracts RTSP hostnames and credentials to pre-fill ONVIF settings, and creates cameras in *Live Only* mode.
- **Configurable Retention Cleanup**: Background hourly pruning removes expired continuous segments and detection clips from both disk and SQLite automatically.
- **Built-in Login**: A sign-in screen protects the web app, live streams and recordings. Passwords are hashed, sessions can be revoked, and failed logins are rate limited.
- **Installable Mobile & Desktop PWA**: Standalone home-screen support for Android, iOS/iPadOS, and desktop browsers with safe-area notch handling and a streaming-safe service worker.

---

### Prerequisites

- Docker & Docker Compose v2
- A running [`go2rtc`](https://github.com/AlexxIT/go2rtc) instance reachable from the xlab-nvr container

## Install

Every xlab app installs and updates the same way: one folder, one `docker-compose.yml`, one `.env`, your data in `./data` and recordings in `./recordings`.

```bash
mkdir -p /opt/xlab-nvr && cd /opt/xlab-nvr
curl -fsSLO https://raw.githubusercontent.com/CJNG20u/xlab-nvr/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/CJNG20u/xlab-nvr/main/.env.example -o .env
docker compose up -d
```

Open `http://<host-ip>:8085`. On first visit you create the admin account (see [Login & Security](#login--security)).

In `docker-compose.yml`, set `TZ` to your time zone (for example `America/Los_Angeles`) so daily folders and timeline timestamps line up, and replace `./recordings:/app/recordings` with your NAS mount if you have one (for example `/mnt/nas-nvr:/app/recordings`). Settings in `.env` (such as `NVR_ADMIN_USER` / `NVR_ADMIN_PASSWORD` or `TRUST_PROXY`) are optional.

## Update

```bash
cd /opt/xlab-nvr
docker compose pull && docker compose up -d
```

Images are built automatically for `linux/amd64` and `linux/arm64`. `:latest` follows `main`; every release also gets version tags (for example `:1.1.0`, `:1`), so you can pin one with `image: ghcr.io/cjng20u/xlab-nvr:1.1.0`.

## Build from source

```bash
git clone https://github.com/CJNG20u/xlab-nvr.git
cd xlab-nvr
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

---

## Connecting `go2rtc` & Importing Cameras

### 1. Example `go2rtc.yaml`

Configure your camera RTSP streams in `go2rtc`:

```yaml
api:
  listen: ":1984"

rtsp:
  listen: ":8554"

streams:
  front_door:
    - rtsp://admin:password@192.168.1.50:554/h264Preview_01_main#backpressure
  driveway:
    - rtsp://admin:password@192.168.1.51:554/h264Preview_01_main#transport=tcp
```

### 2. Point xlab-nvr to `go2rtc`

1. Open **Settings** in xlab-nvr.
2. Under **System & Retention**, enter:
   - **go2rtc HTTP URL**: e.g., `http://192.168.1.10:1984` (or `http://go2rtc:1984` on a shared Docker network).
   - **go2rtc RTSP Host**: e.g., `192.168.1.10:8554` (or `go2rtc:8554`).
3. Click **Save Settings**.

### 3. One-Click "Import from go2rtc"

Click **Import from go2rtc** next to the **go2rtc HTTP URL** field (or inside the **+ Add Camera** modal):

- xlab-nvr queries `GET <go2rtcUrl>/api/streams` and skips any stream already configured.
- Each new stream key is formatted into a clean camera name (e.g., `front_door` → `Front Door`) and added in **Live Only** mode (`recordContinuous: false`, `detectObjects: false`).
- If a stream's producer contains an `rtsp://` URL, xlab-nvr automatically strips trailing `#...` flags and pre-fills `onvifHost`, `onvifUser`, and `onvifPass` so hardware ONVIF detection is ready with a single toggle.

---

## Login & Security

The first time you open xlab-nvr it asks you to create an admin account (username + a password of at least 10 characters). After that, every page, live stream and recording needs a sign-in. You stay signed in for 30 days on each device, and you can change your password or sign out everywhere under **Settings → Security**.

**Open it right after you start the container.** Until the account exists, whoever reaches the page first can create it. To skip that, set the account up from the compose file instead:

```yaml
environment:
  - NVR_ADMIN_USER=admin
  - NVR_ADMIN_PASSWORD=choose-a-long-password   # only used when no account exists yet
```

| Variable | What it does |
| --- | --- |
| `NVR_ADMIN_USER` / `NVR_ADMIN_PASSWORD` | Creates the admin account on first start. Ignored once an account exists. |
| `TRUST_PROXY` | Set to `1` when xlab-nvr sits behind one reverse proxy (Caddy, nginx, Cloudflare Tunnel) so login rate limiting sees each visitor's real IP. |
| `NVR_ALLOWED_ORIGINS` | Only needed if your proxy rewrites the `Host` header and sign-in is rejected as cross-origin. Comma-separated hostnames, e.g. `nvr.example.com`. |
| `NVR_AUTH_DISABLED` | `true` turns the login off. Only use it behind another access layer such as mTLS or a VPN. |

**Forgot your password?** Stop the container, delete `data/auth.json`, and start it again. xlab-nvr will ask you to create a new account. Your cameras and recordings are not touched.

Login protects access, but it doesn't encrypt traffic. For use outside your home network, put xlab-nvr behind HTTPS (see below).

---

## Optional Reverse Proxy (Caddy + HTTPS for PWA)

Installing xlab-nvr as a mobile/desktop PWA requires HTTPS (or `localhost`). When placing xlab-nvr behind **Caddy**, enable `flush_interval -1` so real-time Server-Sent Events (`/api/events/stream`) and WebSocket MSE live streams pass through without buffering:

```caddyfile
nvr.example.com {
    reverse_proxy 127.0.0.1:8085 {
        flush_interval -1
    }
}
```

If you use a reverse proxy, also set `TRUST_PROXY=1` (see [Login & Security](#login--security)).

Once served over HTTPS, open **Settings → Install App (PWA)** to install xlab-nvr directly to Android, iOS/iPadOS, or desktop.

---

## Storage Layout

```text
/data/
├── settings.json           # Global go2rtc endpoints & retention policy
├── cameras.json            # Per-camera stream, ONVIF, and mode settings
└── nvr.db                  # SQLite index for continuous segments & detection clips

/app/recordings/
└── <camera_id>/
    ├── continuous/
    │   └── YYYY-MM-DD/
    │       └── HH-MM-SS.mp4
    └── clips/
        └── YYYY-MM-DD/
            ├── <timestamp>_<label>.mp4
            └── <timestamp>_<label>.jpg
```

---

## Local Development

```bash
npm install
npm run dev
```

The development server runs on `http://localhost:3000` with Express API routes and Vite middleware mounted together.

## License

MIT
