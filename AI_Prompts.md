# AI Prompts Used

This document lists all prompts used for AI/LLM integration in the Intelligent API Monitoring & Alert System, per the assignment's AI usage disclosure requirement.

## 1. Gemini Alert Generation Prompt

**Purpose:** Generate concise, human-readable alert messages for detected API anomalies using Google Gemini.

**Where used:** `src/services/aiAlertService.js` → `buildPrompt(anomaly)`

**Model target:** Google Gemini (`gemini-1.5-flash` by default), configured via `GEMINI_MODEL`. SDK: `@google/genai`.

**Prompt template:**

```
You are an expert API monitoring engineer. Generate a concise, human-readable alert for the following verified API anomaly.

VERIFIED FACTS (do not question or re-evaluate these; the rule engine already determined this is an anomaly):
- API name: {{api_name}}
- Status code: {{status_code}}
- Response time: {{response_time_ms}} ms
- Records returned: {{records_returned}}
- Detected Issue(s): {{issues}}
- Severity: {{severity}}

TASK: Write a 2-3 sentence alert with exactly these three labelled parts:
1. ISSUE: State the observed problem using only the verified facts above.
2. Hypothesis: Offer one possible explanation, clearly prefixed with "Hypothesis:". Treat this as uncertain, not a confirmed root cause.
3. NEXT ACTION: Recommend one concrete next step for the on-call engineer.

Do not include any patient-identifying information. Do not include any preamble beyond the three labelled parts. Output plain text only, no markdown formatting.

Alert:
```

**Template variables:**
- `{{api_name}}` — name of the monitored API (metadata only, no patient data)
- `{{status_code}}` — HTTP status code (or N/A)
- `{{response_time_ms}}` — response time in milliseconds (or N/A)
- `{{records_returned}}` — number of records returned (or N/A)
- `{{issues}}` — semicolon-joined list of detected issue descriptions
- `{{severity}}` — computed severity (critical/high/medium/low)

**Example Gemini SDK request:**

```js
await client.models.generateContent({
  model: 'gemini-1.5-flash',
  contents: '<prompt template with variables filled>',
  config: {
    temperature: 0.4,
    maxOutputTokens: 200,
  }
});
```

**Example generated alert:**

> ISSUE: AppointmentAPI failed with status 500 and returned 0 records.
> Hypothesis: The upstream service may be experiencing an outage or database connectivity issue.
> NEXT ACTION: Check the AppointmentAPI health endpoint and review recent deployment logs.

## Design Principle: Deterministic Rules First, LLM Second

The rule engine (`src/services/anomalyService.js`) is the **source of truth** for anomaly detection and severity. Gemini is strictly a **wordsmith** — it receives only verified facts already determined by the rules and is not allowed to re-evaluate whether an anomaly exists. This ensures:

- Reproducible, auditable anomaly detection
- No hallucinated anomalies from the LLM
- Fallback to template alerts when the LLM is unavailable

## 2. Fallback (Template) Alert Logic

**Purpose:** Produce a human-readable alert when Gemini is unavailable, rate-limited, misconfigured, or returns invalid content. The anomaly is persisted even when LLM generation fails.

**Where used:** `src/services/aiAlertService.js` → `buildFallbackAlert(anomaly)`

This is a deterministic template with three labelled parts:

> {{api_name}} {{failed with status N / is slow (N ms) / returned N records}}. Hypothesis: {{possible cause.}} Next action: {{recommended step.}}

Example: "AppointmentAPI failed with status 500 and returned 0 records. Hypothesis: possible outage or server issue. Next action: check upstream service health and recent deployments."

## 3. Configuration

Set in `.env` (never hardcode secrets):

- `GEMINI_API_KEY` — required to enable real Gemini alert generation
- `GEMINI_MODEL` — model name (default `gemini-1.5-flash`)

If `GEMINI_API_KEY` is unset, the system automatically uses the fallback template alerts.

## 4. Reliability Features

- **Timeout:** 15 seconds per Gemini request (`AbortSignal.timeout`)
- **Retries:** Up to 2 retries with exponential backoff (1s, 2s) for transient errors (429, 503, 504, network timeouts)
- **Response validation:** Rejects responses missing text content or required labelled sections (ISSUE/Hypothesis/NEXT ACTION)
- **Fallback:** Template-based alert on any failure — alerting never stops
- **No PII:** Only metadata (API name, status code, latency, record count) is sent to the model — never patient-identifying information

## 5. Notes

- Temperature is set to `0.4` for consistent, factual alerts.
- All prompt text is hard-coded in `src/services/aiAlertService.js` for transparency and auditability.
- The anomaly record is persisted to the database regardless of LLM success or failure.
