const STORAGE_KEY = 'cloudpulse.monitors.v1';

// The Lambda accepts one public website address per request.
const CHECK_API_URL = 'https://sy4zfrcxnl35ms2g2cal6nddry0unxcw.lambda-url.eu-north-1.on.aws/';
const CLOUDPULSE_URL = 'https://d61mkgexvp9pd.cloudfront.net/';
const cloudpulseMonitor = {
  id: 'cloudpulse', name: 'CloudPulse', url: CLOUDPULSE_URL,
  status: 'Not checked', response: '', checked: '', mark: 'C', style: '',
};

const websiteRows = document.querySelector('#monitor-rows');
const modal = document.querySelector('#modal-backdrop');
const form = document.querySelector('#monitor-form');
const toast = document.querySelector('#toast');
let websites = loadWebsites();
let toastTimeout;

function loadWebsites() {
  let saved = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) saved = parsed;
  } catch {
    // Ignore invalid browser data and start with the CloudPulse monitor.
  }

  // Remove the old demo entries and retain valid user-added websites.
  const custom = saved.filter((site) => {
    if (!site || ['vercel', 'stripe', 'linear', 'cloudpulse'].includes(site.id)) return false;
    try {
      const url = new URL(site.url);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname !== new URL(CLOUDPULSE_URL).hostname;
    } catch { return false; }
  }).map((site) => ({ ...site, status: 'Not checked', response: '', checked: '' }));
  return [{ ...cloudpulseMonitor }, ...custom];
}

function saveWebsites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(websites));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return replacements[character];
  });
}

function getDomain(address) {
  return new URL(address).hostname.replace(/^www\./, '');
}

function createWebsiteRow(website) {
  const needsCloudSetup = website.status !== 'Operational';
  const statusStyle = needsCloudSetup ? ' pending' : '';
  const statusLabel = website.status;
  const responseTime = website.response ? `${escapeHtml(website.response)} <small>ms</small>` : '—';
  const lastChecked = website.checked || 'Not checked yet';

  return `
    <tr>
      <td>
        <div class="website">
          <span class="website-mark ${escapeHtml(website.style || '')}">${escapeHtml(website.mark)}</span>
          <span class="website-copy">
            <strong>${escapeHtml(website.name)}</strong>
            <small>${escapeHtml(getDomain(website.url))}</small>
          </span>
        </div>
      </td>
      <td><span class="status${statusStyle}"><i></i>${escapeHtml(statusLabel)}</span></td>
      <td class="response">${responseTime}</td>
      <td class="last-checked">${escapeHtml(lastChecked)}</td>
      <td>${website.id === 'cloudpulse' ? '' : `<button class="remove-button" data-remove="${escapeHtml(website.id)}" type="button" aria-label="Remove ${escapeHtml(website.name)}">×</button>`}</td>
    </tr>`;
}

function renderWebsites() {
  websiteRows.innerHTML = websites.map(createWebsiteRow).join('');

  const onlineCount = websites.filter((website) => website.status === 'Operational').length;
  document.querySelector('#monitor-count').textContent = websites.length;
  document.querySelector('#online-count').innerHTML = `${onlineCount} <small>of ${websites.length}</small>`;
  const measured = websites.filter((site) => site.status === 'Operational' && site.response !== '');
  const average = measured.length ? Math.round(measured.reduce((sum, site) => sum + Number(site.response), 0) / measured.length) : '—';
  document.querySelector('#average-response').textContent = average;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2800);
}

function openModal() {
  modal.hidden = false;
  document.querySelector('#site-name').focus();
}

function closeModal() {
  modal.hidden = true;
  form.reset();
  document.querySelector('#form-error').textContent = '';
}

document.querySelector('#open-modal').addEventListener('click', openModal);
document.querySelector('#close-modal').addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = document.querySelector('#site-name').value.trim();
  const address = document.querySelector('#site-url').value.trim();
  const errorMessage = document.querySelector('#form-error');
  let parsedAddress;

  try {
    parsedAddress = new URL(address);
  } catch {
    errorMessage.textContent = 'Enter a complete address, like https://example.com.';
    return;
  }

  if (!['http:', 'https:'].includes(parsedAddress.protocol) || parsedAddress.username || parsedAddress.password || parsedAddress.port || address.length > 2048) {
    errorMessage.textContent = 'Use HTTP or HTTPS without a username, password, or custom port.';
    return;
  }

  const alreadyAdded = websites.some((website) => getDomain(website.url) === getDomain(parsedAddress.href));
  if (alreadyAdded) {
    errorMessage.textContent = 'This website is already in your list.';
    return;
  }

  websites.unshift({
    id: crypto.randomUUID(),
    name,
    url: parsedAddress.href,
    status: 'Not checked',
    response: '',
    checked: 'Not checked yet',
    mark: getDomain(parsedAddress.href).charAt(0).toUpperCase(),
    style: '',
  });

  saveWebsites();
  renderWebsites();
  closeModal();
  showToast('Website added. Click Refresh to check it.');
});

websiteRows.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove]');
  if (!removeButton || removeButton.dataset.remove === 'cloudpulse' || refreshButton.disabled) return;

  websites = websites.filter((website) => website.id !== removeButton.dataset.remove);
  saveWebsites();
  renderWebsites();
  showToast('Website removed from this browser.');
});

// Refresh checks each listed website in order.
const refreshButton = document.querySelector('#refresh-button');
refreshButton.addEventListener('click', async () => {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  refreshButton.textContent = 'Checking…';
  const monitors = [...websites];
  document.querySelector('#open-modal').disabled = true;
  for (const monitor of monitors) {
    monitor.status = 'Waiting…';
    monitor.response = '';
    monitor.checked = '';
  }
  renderWebsites();

  try {
    // Sequential checks keep the number of simultaneous Lambda calls small.
    for (const monitor of monitors) {
      monitor.status = 'Checking…';
      renderWebsites();
      try {
        const response = await fetch(`${CHECK_API_URL}?url=${encodeURIComponent(monitor.url)}`, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Check service returned an error');
        const result = await response.json();
        if (result.url !== (() => { const url = new URL(monitor.url); url.hash = ''; return url.href; })() ||
            !['Operational', 'HTTP error', 'Unreachable'].includes(result.status) ||
            !Number.isFinite(result.responseTimeMs) || result.responseTimeMs < 0 ||
            !Number.isFinite(Date.parse(result.checkedAt))) {
          throw new Error('Invalid check result');
        }
        monitor.status = result.status;
        monitor.response = result.status === 'Unreachable' ? '' : String(result.responseTimeMs);
        monitor.checked = new Date(result.checkedAt).toLocaleString();
      } catch {
        // An API/CORS error does not prove that the monitored website is down.
        monitor.status = 'Check failed';
        monitor.response = '';
        monitor.checked = '';
      }
      renderWebsites();
    }
    showToast('Checks completed. See each website for its result.');
  } finally {
    document.querySelector('#open-modal').disabled = false;
    renderWebsites();
    refreshButton.disabled = false;
    refreshButton.innerHTML = '↻ <span>Refresh</span>';
  }
});

renderWebsites();
