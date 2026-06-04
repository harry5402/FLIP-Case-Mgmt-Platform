requireAuth();

// Sidebar nav
document.querySelectorAll('.automation-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.automation-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.automation-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    const panel = document.getElementById('panel-' + item.dataset.panel);
    if (panel) panel.classList.add('active');
  });
});

// Logout
document.getElementById('logout-button').addEventListener('click', async () => {
  await authFetch('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('flipAuth');
  location.href = 'login.html';
});

// ── Exhibit 2 ──────────────────────────────────────────────────────────────

let csvFile = null;
let csvColumns = [];
let currentJobId = null;
let pollInterval = null;

const dropZone = document.getElementById('csv-drop-zone');
const fileInput = document.getElementById('csv-file-input');
const csvPreview = document.getElementById('csv-preview');
const csvPreviewText = document.getElementById('csv-preview-text');
const colChips = document.getElementById('col-chips');
const runBtn = document.getElementById('exhibit2-run-btn');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleCsvFile(f);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleCsvFile(fileInput.files[0]);
});

function handleCsvFile(file) {
  csvFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const firstLine = e.target.result.split('\n')[0];
    const cols = firstLine.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    csvColumns = cols;

    const rowCount = e.target.result.split('\n').filter(l => l.trim()).length - 1;
    const hasUrl = cols.some(c => c.toLowerCase() === 'url');

    csvPreviewText.textContent = `${escapeHtml(file.name)} — ${rowCount} row${rowCount !== 1 ? 's' : ''} detected`;
    colChips.innerHTML = '';
    cols.forEach(col => {
      const chip = document.createElement('span');
      chip.className = 'col-chip' + (col.toLowerCase() === 'url' ? ' url-chip' : '') + (!hasUrl && col.toLowerCase() !== 'url' ? '' : '');
      chip.textContent = col;
      colChips.appendChild(chip);
    });
    if (!hasUrl) {
      const warn = document.createElement('span');
      warn.className = 'col-chip missing';
      warn.textContent = '⚠ no "url" column found';
      colChips.appendChild(warn);
    }
    csvPreview.classList.add('visible');
    runBtn.disabled = !hasUrl;
  };
  reader.readAsText(file);
}

runBtn.addEventListener('click', async () => {
  if (!csvFile) return;
  runBtn.disabled = true;
  runBtn.textContent = 'Starting…';

  const formData = new FormData();
  formData.append('csv', csvFile);
  const matter = document.getElementById('arg-matter').value.trim();
  const operator = document.getElementById('arg-operator').value.trim();
  if (matter) formData.append('matter', matter);
  if (operator) formData.append('operator', operator);

  try {
    const res = await authFetch('/api/automations/exhibit2/start', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start job');
    currentJobId = data.jobId;
    showJobStatus(data.urls);
    startPolling();
  } catch (err) {
    alert('Error: ' + err.message);
    runBtn.disabled = false;
    runBtn.textContent = 'Generate PDF';
  }
});

function showJobStatus(urls) {
  const section = document.getElementById('job-status-section');
  section.classList.add('visible');
  document.getElementById('job-status-heading').textContent = 'Processing…';
  document.getElementById('download-pdf-btn').classList.add('hidden');
  document.getElementById('stat-total').textContent = urls.length;
  document.getElementById('stat-done').textContent = '0';
  document.getElementById('stat-failed').textContent = '0';
  document.getElementById('progress-bar-fill').style.width = '0%';

  const tbody = document.getElementById('url-status-tbody');
  tbody.innerHTML = '';
  urls.forEach((url, i) => {
    const tr = document.createElement('tr');
    tr.id = 'url-row-' + i;
    tr.innerHTML = `<td>${i + 1}</td><td title="${escapeHtml(url)}">${escapeHtml(url)}</td><td><span class="status-badge pending">Pending</span></td><td></td>`;
    tbody.appendChild(tr);
  });
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollJob, 2000);
}

async function pollJob() {
  if (!currentJobId) return;
  try {
    const res = await authFetch(`/api/automations/exhibit2/${currentJobId}/status`);
    const data = await res.json();
    if (!res.ok) return;
    updateJobUI(data);
    if (data.state === 'done' || data.state === 'error') {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  } catch (_) {}
}

function updateJobUI(data) {
  const total = data.urls.length;
  const done = data.urls.filter(u => u.status === 'done').length;
  const failed = data.urls.filter(u => u.status === 'failed').length;
  const finished = done + failed;

  document.getElementById('stat-done').textContent = done;
  document.getElementById('stat-failed').textContent = failed;
  document.getElementById('progress-bar-fill').style.width = total ? Math.round((finished / total) * 100) + '%' : '0%';

  if (data.state === 'done') {
    document.getElementById('job-status-heading').textContent = 'Complete';
    runBtn.textContent = 'Generate PDF';
    runBtn.disabled = false;
    const dlBtn = document.getElementById('download-pdf-btn');
    dlBtn.classList.remove('hidden');
    dlBtn.onclick = downloadPdf;
  } else if (data.state === 'error') {
    document.getElementById('job-status-heading').textContent = 'Job failed';
    runBtn.textContent = 'Generate PDF';
    runBtn.disabled = false;
  }

  data.urls.forEach((u, i) => {
    const row = document.getElementById('url-row-' + i);
    if (!row) return;
    const badge = row.querySelector('.status-badge');
    badge.className = 'status-badge ' + u.status;
    badge.textContent = u.status.charAt(0).toUpperCase() + u.status.slice(1);
    row.cells[3].textContent = u.note || '';
  });
}

async function downloadPdf() {
  const res = await authFetch(`/api/automations/exhibit2/${currentJobId}/download`);
  if (!res.ok) { alert('Download failed'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `exhibit2_${currentJobId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
