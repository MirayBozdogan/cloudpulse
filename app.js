const STORAGE_KEY = 'cloudpulse.monitors.v1';

const exampleWebsites = [
  { id: 'vercel', name: 'Vercel', url: 'https://vercel.com', status: 'Operational', response: '142', checked: '1 min ago', mark: '▲', style: 'dark' },
  { id: 'stripe', name: 'Stripe API', url: 'https://api.stripe.com', status: 'Operational', response: '186', checked: '2 min ago', mark: 'S', style: '' },
  { id: 'linear', name: 'Linear', url: 'https://linear.app', status: 'Operational', response: '224', checked: '4 min ago', mark: 'L', style: 'green' },
];

const websiteRows = document.querySelector('#monitor-rows');
const modal = document.querySelector('#modal-backdrop');
const form = document.querySelector('#monitor-form');
const toast = document.querySelector('#toast');
let websites = loadWebsites();
let toastTimeout;

function loadWebsites() {
  const savedWebsites = localStorage.getItem(STORAGE_KEY);

  if (savedWebsites) {
    try {
      return JSON.parse(savedWebsites);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  return exampleWebsites;
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
  const statusLabel = needsCloudSetup ? 'Not checked' : website.status;
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
      <td><span class="status${statusStyle}"><i></i>${statusLabel}</span></td>
      <td class="response">${responseTime}</td>
      <td class="last-checked">${escapeHtml(lastChecked)}</td>
      <td><button class="remove-button" data-remove="${escapeHtml(website.id)}" type="button" aria-label="Remove ${escapeHtml(website.name)}">×</button></td>
    </tr>`;
}

function renderWebsites() {
  websiteRows.innerHTML = websites.map(createWebsiteRow).join('');

  const onlineCount = websites.filter((website) => website.status === 'Operational').length;
  document.querySelector('#monitor-count').textContent = websites.length;
  document.querySelector('#online-count').innerHTML = `${onlineCount} <small>of ${websites.length}</small>`;
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

  if (!['http:', 'https:'].includes(parsedAddress.protocol)) {
    errorMessage.textContent = 'The address must start with http:// or https://.';
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
  showToast('Website added. Automatic checks come in a later step.');
});

websiteRows.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove]');
  if (!removeButton) return;

  websites = websites.filter((website) => website.id !== removeButton.dataset.remove);
  saveWebsites();
  renderWebsites();
  showToast('Website removed from this browser.');
});

document.querySelector('#refresh-button').addEventListener('click', () => {
  showToast('Automatic checks will be connected in the AWS steps.');
});

renderWebsites();
