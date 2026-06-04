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

// ── Edison Cover Pages ──────────────────────────────────────────────────────

let edisonFiles = []; // ordered array of File objects

const edisonDropZone = document.getElementById('edison-drop-zone');
const edisonFileInput = document.getElementById('edison-file-input');
const edisonFileList = document.getElementById('edison-file-list');
const edisonRunBtn = document.getElementById('edison-run-btn');

edisonDropZone.addEventListener('click', () => edisonFileInput.click());
edisonDropZone.addEventListener('dragover', e => { e.preventDefault(); edisonDropZone.classList.add('drag-over'); });
edisonDropZone.addEventListener('dragleave', () => edisonDropZone.classList.remove('drag-over'));
edisonDropZone.addEventListener('drop', e => {
  e.preventDefault();
  edisonDropZone.classList.remove('drag-over');
  addEdisonFiles(Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf'));
});
edisonFileInput.addEventListener('change', () => {
  addEdisonFiles(Array.from(edisonFileInput.files));
  edisonFileInput.value = '';
});

function addEdisonFiles(files) {
  edisonFiles = edisonFiles.concat(files);
  renderEdisonFileList();
}

function renderEdisonFileList() {
  edisonFileList.innerHTML = '';
  edisonFiles.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'edison-file-row';
    row.innerHTML = `
      <span class="part-label">Part ${i + 1}</span>
      <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <button class="move-btn" data-dir="up" data-idx="${i}" title="Move up">▲</button>
      <button class="move-btn" data-dir="down" data-idx="${i}" title="Move down">▼</button>
      <button class="move-btn" data-dir="remove" data-idx="${i}" title="Remove">✕</button>
    `;
    edisonFileList.appendChild(row);
  });
  edisonFileList.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const dir = btn.dataset.dir;
      if (dir === 'up' && idx > 0) {
        [edisonFiles[idx - 1], edisonFiles[idx]] = [edisonFiles[idx], edisonFiles[idx - 1]];
      } else if (dir === 'down' && idx < edisonFiles.length - 1) {
        [edisonFiles[idx], edisonFiles[idx + 1]] = [edisonFiles[idx + 1], edisonFiles[idx]];
      } else if (dir === 'remove') {
        edisonFiles.splice(idx, 1);
      }
      renderEdisonFileList();
      edisonRunBtn.disabled = edisonFiles.length === 0;
    });
  });
  edisonRunBtn.disabled = edisonFiles.length === 0;
}

edisonRunBtn.addEventListener('click', async () => {
  const clientName = document.getElementById('edison-client-name').value.trim();
  if (!clientName) { alert('Please enter a client name.'); return; }
  if (edisonFiles.length === 0) return;

  edisonRunBtn.disabled = true;
  edisonRunBtn.textContent = 'Processing…';

  const formData = new FormData();
  formData.append('clientName', clientName);
  edisonFiles.forEach(f => formData.append('pdfs', f));

  try {
    const res = await authFetch('/api/automations/edison/apply', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    showEdisonResults(data.files);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    edisonRunBtn.disabled = false;
    edisonRunBtn.textContent = 'Apply Cover Pages';
  }
});

function showEdisonResults(files) {
  const results = document.getElementById('edison-results');
  results.classList.remove('hidden');
  results.innerHTML = `<h3>Done — ${files.length} PDF${files.length !== 1 ? 's' : ''} ready</h3><div class="edison-download-list"></div>`;
  const list = results.querySelector('.edison-download-list');
  files.forEach(f => {
    const row = document.createElement('div');
    row.className = 'edison-download-row';
    row.innerHTML = `<span class="dl-name">${escapeHtml(f.name)}</span><button class="ghost-button" type="button">Download</button>`;
    row.querySelector('button').addEventListener('click', () => downloadEdisonFile(f.token, f.name));
    list.appendChild(row);
  });
}

async function downloadEdisonFile(token, name) {
  const res = await authFetch(`/api/automations/edison/download/${token}`);
  if (!res.ok) { alert('Download failed'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
