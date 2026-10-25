const API_BASE = '';

const el = {
  btnRefresh: document.getElementById('btnRefresh'),
  btnSubmit: document.getElementById('btnSubmit'),
  btnLoadExample: document.getElementById('btnLoadExample'),
  jsonInput: document.getElementById('jsonInput'),
  alertsList: document.getElementById('alertsList'),
  emptyState: document.getElementById('emptyState'),
  statusBadge: document.getElementById('statusBadge'),
  countBadge: document.getElementById('countBadge'),
  submitResult: document.getElementById('submitResult')
};

let refreshTimer = null;

// Severity label config
const SEVERITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

function setStatus(text, kind = 'neutral') {
  el.statusBadge.textContent = text;
  el.statusBadge.className = `badge badge-${kind}`;
}

function formatTime(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString();
}

function renderAlerts(alerts) {
  el.alertsList.innerHTML = '';

  if (!alerts || alerts.length === 0) {
    el.emptyState.style.display = 'block';
    el.countBadge.textContent = '0 alerts';
    return;
  }

  el.emptyState.style.display = 'none';
  el.countBadge.textContent = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;

  for (const a of alerts) {
    const item = document.createElement('div');
    item.className = `alert-item ${a.severity || 'medium'}`;

    const metaParts = [];
    if (a.status_code != null) metaParts.push(`Status ${a.status_code}`);
    if (a.response_time_ms != null) metaParts.push(`${a.response_time_ms} ms`);
    if (a.records_returned != null) metaParts.push(`${a.records_returned} records`);

    item.innerHTML = `
      <div class="alert-severity">${SEVERITY_LABELS[a.severity] || a.severity}</div>
      <div class="alert-content">
        <div class="alert-api">${escapeHtml(a.api_name || 'Unknown API')}</div>
        <div class="alert-message">${escapeHtml(a.ai_alert || a.message || 'Anomaly detected')}</div>
        <div class="alert-meta">
          ${metaParts.join('  |  ')}
          ${a.detected_at ? '  |  ' + formatTime(a.detected_at) : ''}
        </div>
      </div>
      <div class="alert-actions">
        <button class="btn-resolve" data-id="${a.id}">Resolve</button>
      </div>
    `;

    el.alertsList.appendChild(item);

    // Attach resolve handler for this item
    item.querySelectorAll('.btn-resolve').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await resolveAlert(id);
      });
    });
  }
}

async function fetchAlerts() {
  setStatus('Loading...', 'neutral');
  try {
    const res = await fetch(`${API_BASE}/alerts?active=true`);
    if (!res.ok) throw new Error(`Failed to load alerts (${res.status})`);
    const data = await res.json();
    renderAlerts(data.alerts || []);
    setStatus('Idle', 'neutral');
  } catch (err) {
    setStatus('Error', 'danger');
    console.error(err);
    el.alertsList.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Unable to load alerts: ${escapeHtml(err.message)}</p></div>`;
    el.emptyState.style.display = 'block';
  }
}

async function resolveAlert(id) {
  try {
    const res = await fetch(`${API_BASE}/alerts/${id}/resolve`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to resolve alert');
    await fetchAlerts();
  } catch (err) {
    console.error(err);
    alert('Failed to resolve alert.');
  }
}

async function submitMonitor(jsonText) {
  setStatus('Analyzing...', 'warning');
  el.submitResult.style.display = 'none';

  try {
    const body = JSON.parse(jsonText);
    const res = await fetch(`${API_BASE}/monitor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || `Request failed (${res.status})`);
    }

    el.submitResult.className = 'result-box success';
    el.submitResult.style.display = 'block';
    el.submitResult.innerHTML = `
      <strong>Detection complete.</strong>
      ${data.inputsReceived} input(s) analyzed &bull;
      ${data.anomaliesDetected} anomaly(ies) detected.
      ${data.email && data.email.sent ? '&bull; Report email sent.' : ''}
    `;

    await fetchAlerts();
    setStatus('Idle', 'neutral');
  } catch (err) {
    el.submitResult.className = 'result-box error';
    el.submitResult.style.display = 'block';
    el.submitResult.textContent = `Error: ${escapeHtml(err.message)}`;
    setStatus('Error', 'danger');
  }
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function init() {
  // Refresh
  el.btnRefresh.addEventListener('click', fetchAlerts);

  // Load example
  el.btnLoadExample.addEventListener('click', () => {
    el.jsonInput.value = `[
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
  },
  {
    "api_name": "BillingAPI",
    "response_time_ms": 800,
    "status_code": 200,
    "records_returned": 0
  }
]`;
  });

  // Submit monitor
  el.btnSubmit.addEventListener('click', () => {
    submitMonitor(el.jsonInput.value);
  });

  // Auto-refresh alerts every 30 seconds
  fetchAlerts();
  refreshTimer = setInterval(fetchAlerts, 30000);
}

document.addEventListener('DOMContentLoaded', init);
