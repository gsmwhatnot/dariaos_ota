# DariaOS OTA Server

DariaOS OTA Server is a Node.js/Express service that provides firmware delivery
and an admin console for managing OTA updates. The server offers a REST API for
devices and a browser-based UI for administrators to upload, publish, and
monitor builds.

## Features

- **OTA Delivery API** – Serves the latest delta/full OTA packages, honors
  mandatory upgrade chains, and supports resumable downloads.
- **Admin Dashboard** – Upload wizard with validation, changelog editor, delta
  adjacency checks, publish/mandatory toggles, and device usage reports.
- **Authentication & Role-Based Access** – Session-based login with captcha,
  viewer/maintainer/admin roles, and audit logging.
- **Download & API Analytics** – Daily JSONL logs aggregated into lightweight
  caches for system metrics, download stats, and device reports.
- **Static Admin UI** – Built with vanilla JS + Chart.js; no build step
  required.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file based on `.env.example` (defaults shown below):

```ini
PORT=8080
HOST=0.0.0.0
SITE_NAME="DariaOS OTA Console"
MAXIMUM_DELTA_DISTANCE=4
BASE_URL=""
SESSION_SECRET="change-me-session-secret"
DEFAULT_ADMIN_USER=admin
DEFAULT_ADMIN_PASSWORD=admin1234
DATA_DIR=./data
LOG_DIR=./logs
UPLOAD_DIR=./uploads
```

- `BASE_URL` is prepended to relative download URLs.
- `MAXIMUM_DELTA_DISTANCE` limits how far a device can jump via deltas.
- Directory settings can point to external storage for data/logs/uploads.

### Running

```bash
npm start
```

The server starts on `http://HOST:PORT`. The admin UI lives at `/admin` and the
health check is `/health`.

### Directory Structure

```
.
├── public/              # Static admin UI (HTML, CSS, JS)
├── src/
│   ├── routes/          # Express routers (auth, firmware, OTA, etc.)
│   ├── server/          # Controllers, middleware, upload logic
│   ├── stores/          # JSON-backed stores and log aggregators
│   └── utils/           # Helpers (version parsing, URL handling, etc.)
├── uploads/             # Firmware uploads (full/, delta/, tmp/)
├── logs/                # Daily JSONL logs (api_YYYY-MM-DD.jsonl, etc.)
├── data/                # Cached JSON state (catalog, report-cache, etc.)
├── README.md
├── package.json
└── .env.example
```

## Firmware Workflow

1. **Upload Wizard** – Collects build.prop metadata, changelog HTML, full OTA
   ZIP (required), and optional delta ZIP. Validates naming, matching
   incrementals, and disk space.
2. **Mandatory/Publish Flags** – Admins choose whether a build is published
   immediately and whether it is a required stop in the upgrade chain.
3. **OTA Decisions** – Devices are guided through mandatory builds and receive
   the best available delta/full package based on their current incremental.

## Logging & Metrics

- **Daily Logs** – `logs/api_YYYY-MM-DD.jsonl`, `logs/audit_...`,
  `logs/download_...` capture access, admin actions, and downloads (excluding
  partial range requests).
- **Aggregators** – `src/stores/reportCache.js` and
  `src/stores/downloadStats.js` rebuild caches when new daily logs appear.
- **System Metrics** – `/api/system/metrics` surfaces CPU, memory, disk usage,
  network rates, and download stats for the dashboard.

## OTA API Overview

- `GET /api/v1/:codename/:channel/:currentVersion/:serial`
  - Returns a JSON body with either an empty `response` array or a list of
    payloads (delta/full). Each payload includes `updatetype` and `mandatory`
    flags.
- `GET /download/:filename`
  - Streams the requested OTA ZIP, supporting HTTP Range requests for resumable
    downloads.

## Security Notes

- Default admin credentials are seeded from environment variables; change them
  immediately in production.
- Session cookies are HMAC-signed using `SESSION_SECRET`.
- Captcha protection is enabled on the login endpoint.

## Contributing

1. Fork the repository and clone locally.
2. Create a feature branch: `git checkout -b feature/my-change`.
3. Commit with conventional, descriptive messages.
4. Open a pull request targeting `review`.

## License

This project is proprietary to DariaOS. All rights reserved.
