/**
 * Frontend Dashboard Controller
 * Operates in Asia/Karachi (PKT UTC+5) timezone.
 */

// State
let currentStatus = null;
let currentMessages = [];
let pollIntervalTimer = null;
let selectedStatusFilter = 'pending';

// DOM Elements
const serverClock = document.getElementById('serverClock');
const connPill = document.getElementById('connPill');
const connLoading = document.getElementById('connLoading');
const connQr = document.getElementById('connQr');
const qrImage = document.getElementById('qrImage');
const connReady = document.getElementById('connReady');
const readyPushname = document.getElementById('readyPushname');
const readyPhone = document.getElementById('readyPhone');
const connDisconnected = document.getElementById('connDisconnected');
const reconnectBtn = document.getElementById('reconnectBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Stats Elements
const statPending = document.getElementById('statPending');
const statSent = document.getElementById('statSent');
const statUncertain = document.getElementById('statUncertain');
const statMissed = document.getElementById('statMissed');

// Form Elements
const scheduleForm = document.getElementById('scheduleForm');
const recipientInput = document.getElementById('recipient');
const schedDateInput = document.getElementById('schedDate');
const schedTimeInput = document.getElementById('schedTime');
const messageTextInput = document.getElementById('messageText');
const charCount = document.getElementById('charCount');
const scheduleBtn = document.getElementById('scheduleBtn');
const presetButtons = document.querySelectorAll('.btn-preset');

// Table Elements
const statusFilter = document.getElementById('statusFilter');
const refreshBtn = document.getElementById('refreshBtn');
const messagesTbody = document.getElementById('messagesTbody');

// Modals
const editModal = document.getElementById('editModal');
const editModalId = document.getElementById('editModalId');
const editId = document.getElementById('editId');
const editRecipient = document.getElementById('editRecipient');
const editDate = document.getElementById('editDate');
const editTime = document.getElementById('editTime');
const editMessageText = document.getElementById('editMessageText');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const editForm = document.getElementById('editForm');

const detailsModal = document.getElementById('detailsModal');
const detailsModalId = document.getElementById('detailsModalId');
const detailStatus = document.getElementById('detailStatus');
const detailRecipient = document.getElementById('detailRecipient');
const detailSchedPkt = document.getElementById('detailSchedPkt');
const detailSchedUtc = document.getElementById('detailSchedUtc');
const detailMsgId = document.getElementById('detailMsgId');
const detailErrorWrap = document.getElementById('detailErrorWrap');
const detailErrorText = document.getElementById('detailErrorText');
const detailBody = document.getElementById('detailBody');
const closeDetailsModalBtn = document.getElementById('closeDetailsModalBtn');
const closeDetailsBtn = document.getElementById('closeDetailsBtn');
const rescheduleBtn = document.getElementById('rescheduleBtn');

// Toast
const toastContainer = document.getElementById('toastContainer');

/**
 * Toast notification helper
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Calculate Karachi (PKT UTC+5) Date object from client
 */
function getKarachiDate() {
  const now = new Date();
  const utcEpoch = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcEpoch + 5 * 3600000);
}

/**
 * Format Date to YYYY-MM-DD
 */
function formatYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format Date to HH:mm
 */
function formatHhMm(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

/**
 * Initialize default form date and time
 */
function initDefaultDateTime() {
  const pkt = getKarachiDate();
  // Default to 15 minutes in the future, rounded up
  pkt.setMinutes(pkt.getMinutes() + 15);
  schedDateInput.value = formatYmd(pkt);
  schedTimeInput.value = formatHhMm(pkt);
}

/**
 * Character counter
 */
messageTextInput.addEventListener('input', () => {
  charCount.innerText = `${messageTextInput.value.length} / 4096`;
});

/**
 * Preset buttons logic
 */
presetButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const addMin = btn.getAttribute('data-add-min');
    const preset = btn.getAttribute('data-preset');
    const pkt = getKarachiDate();

    if (addMin) {
      pkt.setMinutes(pkt.getMinutes() + parseInt(addMin, 10));
      schedDateInput.value = formatYmd(pkt);
      schedTimeInput.value = formatHhMm(pkt);
    } else if (preset === 'tonight') {
      pkt.setHours(21, 0, 0, 0);
      schedDateInput.value = formatYmd(pkt);
      schedTimeInput.value = '21:00';
    } else if (preset === 'tomorrow') {
      pkt.setDate(pkt.getDate() + 1);
      pkt.setHours(10, 0, 0, 0);
      schedDateInput.value = formatYmd(pkt);
      schedTimeInput.value = '10:00';
    }
  });
});

/**
 * Fetch and update WhatsApp Connection Status
 */
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await res.json();
    if (!data.success) return;

    currentStatus = data;
    renderStatus(data);
    renderStats(data.stats);
  } catch (err) {
    console.warn('Status fetch error:', err);
  }
}

/**
 * Render Status Cards and Badges
 */
function renderStatus(data) {
  const { whatsapp, serverTime } = data;

  if (serverTime) {
    serverClock.innerText = `🕒 ${serverTime.karachiFormatted}`;
  }

  connLoading.style.display = 'none';
  connQr.style.display = 'none';
  connReady.style.display = 'none';
  connDisconnected.style.display = 'none';

  connPill.className = 'status-pill';

  switch (whatsapp.status) {
    case 'READY':
      connPill.classList.add('status-pill-ready');
      connPill.innerText = 'Connected';
      connReady.style.display = 'flex';
      readyPushname.innerText = whatsapp.clientInfo?.pushname || 'Connected Device';
      readyPhone.innerText = `User ID: ${whatsapp.clientInfo?.wid || 'Online'}`;
      break;

    case 'QR_READY':
      connPill.classList.add('status-pill-qr');
      connPill.innerText = 'Scan QR';
      connQr.style.display = 'block';
      fetchQrCode();
      break;

    case 'AUTHENTICATING':
    case 'INITIALIZING':
      connPill.classList.add('status-pill-connecting');
      connPill.innerText = 'Starting...';
      connLoading.style.display = 'flex';
      break;

    case 'DISCONNECTED':
    case 'AUTH_FAILURE':
    default:
      connPill.classList.add('status-pill-error');
      connPill.innerText = 'Disconnected';
      connDisconnected.style.display = 'block';
      break;
  }
}

/**
 * Fetch QR image
 */
async function fetchQrCode() {
  try {
    const res = await fetch('/api/qr');
    const data = await res.json();
    if (data.hasQr && data.qrDataUrl) {
      qrImage.src = data.qrDataUrl;
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Render Stats Counters
 */
function renderStats(stats) {
  if (!stats) return;
  statPending.innerText = stats.pending || 0;
  statSent.innerText = stats.sent || 0;
  statUncertain.innerText = stats.uncertain || 0;
  statMissed.innerText = stats.missed || 0;
}

// Click stats to filter
document.querySelectorAll('.stat-card').forEach((card) => {
  card.addEventListener('click', () => {
    const filter = card.getAttribute('data-filter');
    statusFilter.value = filter;
    selectedStatusFilter = filter;
    fetchMessages();
  });
});

/**
 * Fetch Messages List
 */
async function fetchMessages() {
  try {
    const res = await fetch(`/api/messages?status=${selectedStatusFilter}`);
    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await res.json();
    if (data.success) {
      currentMessages = data.messages;
      renderMessagesTable(data.messages);
    }
  } catch (err) {
    console.error('Error fetching messages:', err);
  }
}

/**
 * Render Messages Table
 */
function renderMessagesTable(messages) {
  if (!messages || messages.length === 0) {
    messagesTbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted" style="padding: 2rem;">
          No scheduled messages found matching filter <strong>'${selectedStatusFilter}'</strong>.
        </td>
      </tr>
    `;
    return;
  }

  messagesTbody.innerHTML = messages
    .map((msg) => {
      const badgeClass = `badge badge-${msg.status}`;
      const isPending = msg.status === 'pending';
      const isUncertainOrMissed = msg.status === 'uncertain' || msg.status === 'missed' || msg.status === 'failed';

      let actionButtons = `
        <button class="action-btn" onclick="openDetailsModal(${msg.id})" title="View Details">👁️</button>
      `;

      if (isPending) {
        actionButtons += `
          <button class="action-btn" onclick="openEditModal(${msg.id})" title="Edit Message">✏️</button>
          <button class="action-btn action-btn-danger" onclick="cancelMessage(${msg.id})" title="Cancel Message">✖</button>
        `;
      } else if (isUncertainOrMissed) {
        actionButtons += `
          <button class="action-btn" onclick="openRescheduleModal(${msg.id})" title="Reschedule as New">↻</button>
        `;
      }

      actionButtons += `
        <button class="action-btn action-btn-danger" onclick="deleteMessage(${msg.id})" title="Delete Record">🗑️</button>
      `;

      return `
        <tr>
          <td>#${msg.id}</td>
          <td><strong>${escapeHtml(msg.recipient)}</strong></td>
          <td class="table-msg-text" title="${escapeHtml(msg.message)}">${escapeHtml(msg.message)}</td>
          <td class="table-time-cell">
            <div class="table-time-pkt">${msg.scheduled_display || msg.scheduled_at_utc}</div>
            <div class="table-time-utc">${msg.scheduled_at_utc}</div>
          </td>
          <td><span class="${badgeClass}">${msg.status}</span></td>
          <td><div class="table-actions">${actionButtons}</div></td>
        </tr>
      `;
    })
    .join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Handle Schedule Form Submission
 */
scheduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  scheduleBtn.disabled = true;
  scheduleBtn.innerText = 'Scheduling...';

  const payload = {
    recipient: recipientInput.value.trim(),
    message: messageTextInput.value.trim(),
    date: schedDateInput.value,
    time: schedTimeInput.value
  };

  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Message #${data.message.id} scheduled for ${data.message.scheduled_display}!`, 'success');
      messageTextInput.value = '';
      charCount.innerText = '0 / 4096';
      initDefaultDateTime();
      fetchStatus();
      fetchMessages();
    } else {
      showToast(data.error || 'Failed to schedule message.', 'danger');
    }
  } catch (err) {
    showToast('Network error while scheduling message.', 'danger');
  } finally {
    scheduleBtn.disabled = false;
    scheduleBtn.innerText = '📅 Schedule Message';
  }
});

/**
 * Filter and Refresh Controls
 */
statusFilter.addEventListener('change', (e) => {
  selectedStatusFilter = e.target.value;
  fetchMessages();
});

refreshBtn.addEventListener('click', () => {
  fetchStatus();
  fetchMessages();
  showToast('Queue refreshed.', 'info');
});

/**
 * Cancel Message
 */
window.cancelMessage = async function (id) {
  if (!confirm(`Are you sure you want to cancel message #${id}?`)) return;

  try {
    const res = await fetch(`/api/messages/${id}/cancel`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Message #${id} has been cancelled.`, 'info');
      fetchStatus();
      fetchMessages();
    } else {
      showToast(data.error || 'Could not cancel message.', 'danger');
    }
  } catch (err) {
    showToast('Network error cancelling message.', 'danger');
  }
};

/**
 * Delete Message
 */
window.deleteMessage = async function (id) {
  if (!confirm(`Delete record for message #${id}?`)) return;

  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`Record #${id} deleted.`, 'info');
      fetchStatus();
      fetchMessages();
    } else {
      showToast(data.error || 'Could not delete record.', 'danger');
    }
  } catch (err) {
    showToast('Network error deleting record.', 'danger');
  }
};

/**
 * Edit Modal
 */
window.openEditModal = function (id) {
  const msg = currentMessages.find((m) => m.id === id);
  if (!msg) return;

  editModalId.innerText = msg.id;
  editId.value = msg.id;
  editRecipient.value = msg.recipient;
  editDate.value = msg.scheduled_karachi_date || '';
  editTime.value = msg.scheduled_karachi_time || '';
  editMessageText.value = msg.message;

  editModal.style.display = 'flex';
};

closeEditModalBtn.addEventListener('click', () => (editModal.style.display = 'none'));
cancelEditBtn.addEventListener('click', () => (editModal.style.display = 'none'));

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = editId.value;

  const payload = {
    recipient: editRecipient.value.trim(),
    date: editDate.value,
    time: editTime.value,
    message: editMessageText.value.trim()
  };

  try {
    const res = await fetch(`/api/messages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Message #${id} updated successfully.`, 'success');
      editModal.style.display = 'none';
      fetchStatus();
      fetchMessages();
    } else {
      showToast(data.error || 'Failed to update message.', 'danger');
    }
  } catch (err) {
    showToast('Network error updating message.', 'danger');
  }
});

/**
 * Details Modal
 */
window.openDetailsModal = function (id) {
  const msg = currentMessages.find((m) => m.id === id);
  if (!msg) return;

  detailsModalId.innerText = msg.id;
  detailStatus.innerHTML = `<span class="badge badge-${msg.status}">${msg.status}</span>`;
  detailRecipient.innerText = msg.recipient;
  detailSchedPkt.innerText = msg.scheduled_display || msg.scheduled_at_utc;
  detailSchedUtc.innerText = msg.scheduled_at_utc;
  detailMsgId.innerText = msg.whatsapp_message_id || 'None';
  detailBody.innerText = msg.message;

  if (msg.error_message) {
    detailErrorWrap.style.display = 'block';
    detailErrorText.innerText = msg.error_message;
  } else {
    detailErrorWrap.style.display = 'none';
  }

  if (msg.status === 'uncertain' || msg.status === 'missed' || msg.status === 'failed') {
    rescheduleBtn.style.display = 'inline-flex';
    rescheduleBtn.onclick = () => {
      detailsModal.style.display = 'none';
      openRescheduleModal(msg.id);
    };
  } else {
    rescheduleBtn.style.display = 'none';
  }

  detailsModal.style.display = 'flex';
};

closeDetailsModalBtn.addEventListener('click', () => (detailsModal.style.display = 'none'));
closeDetailsBtn.addEventListener('click', () => (detailsModal.style.display = 'none'));

/**
 * Reschedule as New Modal / Action
 */
window.openRescheduleModal = function (id) {
  const msg = currentMessages.find((m) => m.id === id);
  if (!msg) return;

  recipientInput.value = msg.recipient;
  messageTextInput.value = msg.message;
  charCount.innerText = `${msg.message.length} / 4096`;
  initDefaultDateTime();
  window.scrollTo({ top: 300, behavior: 'smooth' });
  showToast(`Loaded message #${id} into scheduler form. Select new date/time to submit.`, 'info');
};

/**
 * WhatsApp Reconnect Action
 */
reconnectBtn.addEventListener('click', async () => {
  if (!confirm('Restart WhatsApp connection and request a new QR scan?')) return;
  reconnectBtn.disabled = true;
  reconnectBtn.innerText = 'Restarting...';

  try {
    const res = await fetch('/api/whatsapp/reconnect', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('WhatsApp client reconnecting...', 'info');
      fetchStatus();
    } else {
      showToast(data.error || 'Failed to reconnect.', 'danger');
    }
  } catch (err) {
    showToast('Network error during reconnect.', 'danger');
  } finally {
    reconnectBtn.disabled = false;
    reconnectBtn.innerText = '🔄 Reconnect / New QR';
  }
});

/**
 * Logout
 */
logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  } catch (err) {
    window.location.href = '/login';
  }
});

/**
 * App Boot
 */
function initApp() {
  initDefaultDateTime();
  fetchStatus();
  fetchMessages();

  // 5-second polling loop
  pollIntervalTimer = setInterval(() => {
    fetchStatus();
    fetchMessages();
  }, 5000);
}

document.addEventListener('DOMContentLoaded', initApp);
