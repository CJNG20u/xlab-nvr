# xlab-nvr

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
- **Installable Mobile & Desktop PWA**: Standalone home-screen support for Android, iOS/iPadOS, and desktop browsers with safe-area notch handling and a streaming-safe service worker.

---

## Architecture

```mermaid
flowchart LR
    subgraph LAN["Local Network / Camera VLAN"]
        CAM["IP Cameras<br/>(RTSP + ONVIF AI)"]
    end

    subgraph STREAM["Stream Relay"]
        G2R["go2rtc<br/>HTTP :1984 · RTSP :8554<br/>WebSocket MSE / Snapshots"]
    end

    subgraph NVR["xlab-nvr Container (Port 8080)"]
        UI["React + Vite PWA<br/>Live Wall · Review · Clips · Exports"]
        API["Node.js + Express Server<br/>/api/* · /go2rtc/* Proxy · SSE"]
        FF["FFmpeg Workers<br/>-c:v copy 5m Segments & Clips"]
        ONV["ONVIF PullPoint Listeners<br/>Person · Vehicle · Pet · Motion"]
        SQL[("SQLite Index<br/>/data/nvr.db")]
        CFG[("JSON Config<br/>/data/settings.json<br/>/data/cameras.json")]
    end

    subgraph STORAGE["Persistent Storage"]
        REC[("Local Disk / NAS Mount<br/>/app/recordings")]
        DATA[("Config & DB Volume<br/>/data")]
    end

    CAM -- "RTSP" --> G2R
    CAM -- "ONVIF PullPoint Events" --> ONV
    G2R -- "WebSocket MSE / Frame JPEG" --> API
    G2R -- "RTSP Restream" --> FF
    API <--> UI
    ONV -- "Trigger Event Clip" --> FF
    FF -- "Write .mp4 & .jpg" --> REC
    FF -- "Index Segments & Clips" --> SQL
    API <--> CFG
    API <--> SQL
    SQL --- DATA
    CFG --- DATA
```

---

## Quick Start & Installation

### Prerequisites

- Docker & Docker Compose v2
- A running [`go2rtc`](https://github.com/AlexxIT/go2rtc) instance reachable from the xlab-nvr container

### 1. Clone the Repository

```bash
git clone https://github.com/<your-username>/xlab-nvr.git
cd xlab-nvr
```

### 2. Configure Storage Volumes (`docker-compose.yml`)

By default, `docker-compose.yml` stores configuration/SQLite in `./data` and recordings in `./recordings`:

```yaml
services:
  xlab-nvr:
    build:
      context: .
      dockerfile: Dockerfile
    image: xlab-nvr:latest
    container_name: xlab-nvr
    restart: unless-stopped
    ports:
      - "8085:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
      - TZ=America/New_York
      - DATA_DIR=/data
      - RECORDINGS_DIR=/app/recordings
    volumes:
      # Local storage (or replace ./recordings with a NAS mount like /mnt/nas-nvr)
      - ./recordings:/app/recordings
      - ./data:/data
```

- **Time Zone**: Update `TZ` to match your local time zone (for example, `America/Los_Angeles` or `Europe/London`) so daily folders and timeline timestamps align with local time.
- **NAS Storage**: Replace `./recordings:/app/recordings` with your mounted NFS/SMB share path (for example, `/mnt/nas-nvr:/app/recordings`).

### 3. Build & Start xlab-nvr

```bash
docker compose up -d --build
```

Open **`http://<host-ip>:8085`** in your browser.

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

## Optional Reverse Proxy (Caddy + HTTPS for PWA)

Installing xlab-nvr as a mobile/desktop PWA requires HTTPS (or `localhost`). When placing xlab-nvr behind **Caddy**, enable `flush_interval -1` so real-time Server-Sent Events (`/api/events/stream`) and WebSocket MSE live streams pass through without buffering:

```caddyfile
nvr.example.com {
    reverse_proxy 127.0.0.1:8085 {
        flush_interval -1
    }
}
```

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
