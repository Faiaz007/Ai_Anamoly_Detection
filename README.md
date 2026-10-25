# Intelligent API Monitoring & Alert System

A modular Node.js/Express backend that monitors API responses, detects anomalies
(health, status codes, data validity), generates AI-powered human-readable alerts
via an LLM, stores them in a SQLite database, and exposes them through a REST API
with a clean frontend UI.

## Features

- **API health monitoring** — response time, HTTP status codes, record counts
- **Anomaly detection** — high response time, failed requests (4xx/5xx), missing/zero records
- **AI-powered alerts** — LLM-generated human-readable alert messages (OpenAI-compatible)
- **Fallback alerts** — template-based alerts when no LLM key is configured
- **Data storage** — SQLite (sql.js, pure JS, no native build) persistence
- **REST API** — `POST /monitor`, `GET /alerts`, `POST /alerts/:id/resolve`, `GET /health`
- **Frontend** — single-page UI to view, resolve, and submit alerts
- **Email reports** — optional SMTP anomaly reports
- **Logging** — structured console + file logging
- **Batch processing** — handles multiple API inputs in one request

## Project Structure

```
intelligent-api-monitor/
├── server.js                 # Express app entry point
├── package.json
├── .env.example              # Copy to .env and configure
├── .gitignore
├── README.md
├── AI_Prompts.md             # Documented LLM prompts used
├── src/
│   ├── config/db.js          # SQLite (sql.js) initialization & schema
│   ├── controllers/
│   │   ├── monitorController.js   # POST /monitor
│   │   └── alertController.js     # GET /alerts, resolve
│   ├── middleware/
│   │   └── errorHandler.js        # Centralized error handling
│   ├── models/
│   │   └── Anomaly.js             # Data access layer
│   ├── routes/
│   │   ├── monitor.js
│   │   └── alert.js
│   ├── services/
│   │   ├── anomalyService.js    # Anomaly detection logic
│   │   ├── aiAlertService.js    # LLM alert generation + fallback
│   │   └── emailService.js      # Optional SMTP email reports
│   └── utils/
│       └── logger.js              # Structured logger (console + file)
├── public/
│   ├── index.html            # Frontend UI
│   ├── style.css
│   └── app.js                # Frontend logic
└── tests/
    └── monitor.test.js       # Node native test tests
```

## Setup & Run

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example env file and fill in values:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:
- `PORT` — server port (default 3000)
- `GEMINI_API_KEY` — your Google Gemini API key to enable AI alerts

Optional:
- `GEMINI_MODEL` — Gemini model name (default `gemini-1.5-flash`)
- `HIGH_RESPONSE_TIME_MS` / `CRITICAL_RESPONSE_TIME_MS` — thresholds
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_EMAIL_TO` — email reports

### 3. Start the server

```bash
npm start
# or
npm run dev
```

Server runs at `http://localhost:3000`.

### 4. Open the UI

Visit `http://localhost:3000` in your browser.

## API Endpoints

### POST /monitor

Submit a batch of API responses for anomaly detection.

**Request body** (JSON array):
```json
[
  {
    "api_name": "PatientDataAPI",
    "response_time_ms": 1200,
    "status_code": 200,
    "records_returned": 50
  },
  {
    "api_name": "AppointmentAPI",
    "response_time_ms": 5500,
    "status_code": 500,
    "records_returned": 0
  }
]
```

**Response:**
```json
{
  "success": true,
  "inputsReceived": 2,
  "anomaliesDetected": 3,
  "anomalies": [ { ...anomaly record with ai_alert... } ],
  "email": { "sent": true, "messageId": "..." }
}
```

### GET /alerts

Fetch all active (unresolved) anomalies.

Query param: `?active=false` to include resolved alerts.

**Response:**
```json
{
  "success": true,
  "activeOnly": true,
  "count": 2,
  "alerts": [ ... ]
}
```

### POST /alerts/:id/resolve

Mark an alert as resolved.

### GET /health

Health check.

## AI Prompts

All LLM prompts used are documented in [`AI_Prompts.md`](AI_Prompts.md).

## Testing

```bash
npm test
```

## Architecture Decisions

- **SQLite via sql.js**: pure JavaScript/WASM build, no native compilation, works anywhere Node runs.
- **Modular layered architecture**: routes → controllers → services → models, keeping concerns separated and easy to extend/test.
- **LLM fallback**: if `GEMINI_API_KEY` is not set or the LLM call fails, the system generates a template-based alert so alerting never stops.
- **Graceful degradation**: email failures and LLM failures are logged but do not fail the monitoring request.
- **Deterministic rules first, LLM second**: the rule engine is the source of truth for anomaly detection and severity; Gemini only words verified facts into a readable alert.

## System Architecture

### High-Level Diagram

```
┌─────────────┐      ┌─────────────────────────────────────────────────────┐
│   Client    │      │              Express Backend (Node.js)                │
│  (Browser)  │◄────►│                                                       │
└─────────────┘      │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐   │
                     │  │   Routes    │  │ Controllers  │  │ Services  │   │
                     │  │ monitor.js  │──│monitorCtrl   │──│anomalySvc │   │
                     │  │ alert.js    │──│alertCtrl     │──│aiAlertSvc │   │
                     │  └─────────────┘  └──────────────┘  │emailSvc   │   │
                     │         ▲                           └───────────┘   │
                     │         │                         ┌───────────┐   │
                     │         └────────────────────────►│  Models   │   │
                     │                                   │  Anomaly  │   │
                     │                                   └─────┬─────┘   │
                     │                                         │           │
                     │                                   ┌─────▼─────┐   │
                     │                                   │   SQLite  │   │
                     │                                   │ (sql.js)  │   │
                     │                                   └───────────┘   │
                     │                                                   │
                     │  ┌─────────────┐  ┌──────────────┐               │
                     │  │   Middleware│  │    Utils     │               │
                     │  │ errorHandler│  │   logger     │               │
                     │  └─────────────┘  └──────────────┘               │
                     └───────────────────────────────────────────────────┘
                          ▲                    ▲                    ▲
                          │                    │                    │
                  ┌───────┴───────┐  ┌────────┴────────┐  ┌────────┴────────┐
                  │   Static      │  │   Gemini API    │  │   SMTP Server   │
                  │   Frontend    │  │   (LLM)         │  │   (Email, opt)  │
                  │   (public/)   │  │   @google/genai │  │   nodemailer    │
                  └───────────────┘  └─────────────────┘  └─────────────────┘
```

### Data Flow: `POST /monitor`

1. **Client** sends a JSON array of API response objects to `POST /monitor`.
2. **Route** (`src/routes/monitor.js`) receives the request, parses body or uploaded file.
3. **Controller** (`src/controllers/monitorController.js`) validates input via `validateBatch()`.
4. **Service** (`src/services/anomalyService.js`) runs deterministic rules on each entry:
   - HTTP status check (4xx/5xx → `failed_request`)
   - Response time check (> threshold → `high_response_time`)
   - Record count check (0 or missing → `missing_or_zero_records`)
   - Data validity check → `malformed_data`
5. Each anomaly gets a **severity** (critical/high/medium/low) from `classifySeverity()`.
6. **AI Service** (`src/services/aiAlertService.js`) receives only verified facts and:
   - Calls Gemini (`@google/genai`) with the prompt containing ISSUE/Hypothesis/NEXT ACTION.
   - Falls back to a template alert if Gemini is unavailable, rate-limited, or misconfigured.
7. **Model** (`src/models/Anomaly.js`) persists the anomaly to SQLite with `ai_alert`.
8. **Email** (`src/services/emailService.js`) fires a report (fire-and-forget, non-fatal).
9. **Response** returns `200` with detected anomalies, `ai_alert` per anomaly, and email status.

### Data Flow: `GET /alerts`

1. Client requests `GET /alerts?active=true`.
2. Controller fetches unresolved anomalies (`resolved = 0`) from SQLite via `Anomaly.findAll()`.
3. Returns JSON array sorted by `detected_at` descending.

### Data Flow: Resolve

1. Client POSTs to `/alerts/:id/resolve`.
2. Model sets `resolved = 1` and `updated_at`.
3. Returns success; anomaly no longer appears in active alerts list.

### Component Responsibilities

| Layer | File | Responsibility |
|-------|------|----------------|
| Entry | `server.js` | Express app, DB init, route mounting, static file serving, error handler |
| Routes | `src/routes/monitor.js`, `alert.js` | URL path → controller mapping, body/multer parsing |
| Controllers | `src/controllers/monitorController.js`, `alertController.js` | Request orchestration, validation, response formatting |
| Services | `src/services/anomalyService.js` | Deterministic anomaly detection + severity |
| | `src/services/aiAlertService.js` | Gemini LLM integration + template fallback |
| | `src/services/emailService.js` | Optional SMTP email reports |
| Models | `src/models/Anomaly.js` | SQLite CRUD (create, find all active, resolve) |
| Config | `src/config/db.js` | SQLite initialization, schema, persistence |
| Utils | `src/utils/logger.js` | Structured console + file logging |
| Middleware | `src/middleware/errorHandler.js` | Centralized JSON error handling |
| Frontend | `public/index.html`, `style.css`, `app.js` | Dashboard UI, alert display, resolve, submit form |

### Frontend Dashboard

- **Active alerts list**: color-coded severity badges (critical/high/medium/low), API name, AI alert message, metadata (status/latency/records), timestamp, resolve button.
- **Submit panel**: paste JSON array, load example, POST to `/monitor`, result banner.
- **Auto-refresh**: polls `GET /alerts` every 30 seconds.

## Testing

```bash
npm test
```

## License

MIT
