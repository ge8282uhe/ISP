// ==================== STATE ====================
let currentUser = null;
let currentAdmin = null;
let selectedClientId = null;
let pinCode = '';
let pinMode = 'client'; // 'client' or 'admin'
let saldoVisible = true;
let showAllMovimenti = false;
let clientMovimentiCache = [];
let clientConti = [];
let activeContoIndex = 0;
let activeContoId = null;
let adminConti = [];
let adminActiveContoId = null;
const movimentoById = new Map();
let movimentoDetailOriginScreen = 'dashboard-screen';

// ==================== UTILS ====================
function fmt(n) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return 'OGGI';
  if (isYesterday) return 'IERI';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase();
}

function fmtDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function getActiveScreenId() {
  const active = document.querySelector('.screen.active');
  return active ? active.id : 'dashboard-screen';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-text').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2500);
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function escHtml(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Errore');
  return data;
}

function updateTime() {
  const t = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  document.querySelectorAll('.dash-time').forEach(el => el.textContent = t);
}

function getMovIcon(tipo, categoria) {
  if (tipo === 'accredito') return 'savings';
  const map = {
    'Pagamento': 'receipt_long',
    'Bonifico': 'swap_horiz',
    'Stipendio': 'work',
    'Casa': 'home',
    'Alimentari': 'shopping_cart',
    'Trasporti': 'directions_car',
    'Intrattenimento': 'movie',
    'Ristorazione': 'restaurant',
    'Salute': 'favorite',
    'Shopping': 'shopping_bag',
    'Utenze': 'bolt',
  };
  return map[categoria] || 'receipt_long';
}

// ==================== WELCOME / PIN ====================
function goToPinScreen(mode) {
  pinMode = mode;
  pinCode = '';
  updateDots();
  document.getElementById('pin-error').classList.add('hidden');
  showScreen('pin-screen');
}

function backToWelcome() {
  pinCode = '';
  showScreen('welcome-screen');
}

function pinPress(digit) {
  if (pinCode.length >= 5) return;
  pinCode += digit;
  updateDots();
  document.getElementById('pin-error').classList.add('hidden');

  if (pinCode.length === 5) {
    setTimeout(() => attemptLogin(), 200);
  }
}

function pinDelete() {
  if (pinCode.length === 0) return;
  pinCode = pinCode.slice(0, -1);
  updateDots();
  document.getElementById('pin-error').classList.add('hidden');
}

function updateDots() {
  const dots = document.querySelectorAll('#pin-dots .dot');
  dots.forEach((d, i) => {
    d.classList.toggle('filled', i < pinCode.length);
  });
}

async function attemptLogin() {
  try {
    if (pinMode === 'client') {
      const data = await api('/api/login', 'POST', { pin: pinCode });
      currentUser = data.user;
      loadDashboard();
      showScreen('dashboard-screen');
    } else {
      const data = await api('/api/admin/login', 'POST', { pin: pinCode });
      currentAdmin = data.admin;
      loadAdminDashboard();
      showScreen('admin-screen');
    }
    pinCode = '';
  } catch (err) {
    document.getElementById('pin-error').textContent = err.message;
    document.getElementById('pin-error').classList.remove('hidden');
    pinCode = '';
    updateDots();
    // Shake animation
    const dots = document.getElementById('pin-dots');
    dots.style.animation = 'none';
    void dots.offsetHeight;
    dots.style.animation = 'shake 0.4s ease';
  }
}

function logout() {
  currentUser = null;
  currentAdmin = null;
  selectedClientId = null;
  saldoVisible = true;
  showAllMovimenti = false;
  clientMovimentiCache = [];
  clientConti = [];
  activeContoIndex = 0;
  activeContoId = null;
  adminConti = [];
  adminActiveContoId = null;
  showScreen('welcome-screen');
}

// ==================== CLIENT DASHBOARD ====================
async function loadDashboard() {
  if (!currentUser) return;

  try {
    const user = await api(`/api/client/${currentUser.id}`);
    currentUser = user;

    const conti = await api(`/api/client/${currentUser.id}/conti`);
    clientConti = conti;
    activeContoIndex = 0;
    activeContoId = conti.length ? conti[0].id : null;

    renderAccountCarousel();
    setupAccountCarouselEvents();
    await loadActiveContoData();
  } catch (err) {
    console.error(err);
  }
}

function renderAccountCarousel() {
  const track = document.getElementById('account-track');
  const dots = document.getElementById('account-dots');
  const tpl = document.getElementById('account-card-template');
  if (!track || !dots || !tpl) return;

  if (clientConti.length === 0) {
    track.innerHTML = '<div class="account-slide"><div class="account-card"><div class="account-card-top"><div class="account-conto">Nessun conto disponibile</div></div></div></div>';
    dots.innerHTML = '';
    return;
  }

  track.innerHTML = '';
  clientConti.forEach((conto) => {
    const node = tpl.content.cloneNode(true);
    const ibanClean = String(conto.iban || '').replace(/\s+/g, '');
    const ibanLast4 = ibanClean.slice(-4).padStart(4, '0');
    node.querySelector('.account-piano').textContent = conto.nome_piano || 'PIANO ISYPRIME';
    node.querySelector('.account-conto').textContent = `Conto 1000/${ibanLast4}`;
    node.querySelector('.account-saldo').textContent = saldoVisible ? `${fmt(conto.saldo)} €` : '•••,•• €';
    node.querySelector('.hide-label').textContent = saldoVisible ? 'Nascondi' : 'Mostra';
    node.querySelector('.account-iban').textContent = conto.iban;
    track.appendChild(node);
  });

  dots.innerHTML = clientConti
    .map((_, index) => `<button class="account-dot ${index === activeContoIndex ? 'active' : ''}" onclick="goToConto(${index})"></button>`)
    .join('');

  const carousel = document.getElementById('account-carousel');
  if (carousel) {
    carousel.scrollLeft = activeContoIndex * carousel.clientWidth;
  }
}

function toggleSaldoVisibility() {
  saldoVisible = !saldoVisible;
  renderAccountCarousel();
}

function updateMovimentiToggleLabel() {
  const link = document.getElementById('toggle-movimenti-link');
  if (!link) return;
  link.innerHTML = showAllMovimenti
    ? 'Mostra meno <span class="material-icons-round" style="font-size:16px;vertical-align:middle">expand_less</span>'
    : 'Visualizza tutte <span class="material-icons-round" style="font-size:16px;vertical-align:middle">chevron_right</span>';
}

function renderClientMovimenti() {
  const movimentiDaMostrare = showAllMovimenti
    ? clientMovimentiCache
    : clientMovimentiCache.slice(0, 4);
  renderMovimenti(movimentiDaMostrare, 'movimenti-list', false);
  updateMovimentiToggleLabel();
}

function toggleMovimenti() {
  showAllMovimenti = !showAllMovimenti;
  renderClientMovimenti();
}

function setupAccountCarouselEvents() {
  const carousel = document.getElementById('account-carousel');
  if (!carousel) return;

  let scrollEndTimer = null;

  carousel.onscroll = () => {
    if (!clientConti.length) return;
    const width = carousel.clientWidth || 1;
    const index = Math.round(carousel.scrollLeft / width);

    if (index !== activeContoIndex && index >= 0 && index < clientConti.length) {
      activeContoIndex = index;
      activeContoId = clientConti[index].id;
      updateAccountDots();
      showAllMovimenti = false;
      loadActiveContoData();
    }

    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
      goToConto(activeContoIndex, true);
    }, 90);
  };
}

function goToConto(index, keepData = false) {
  const carousel = document.getElementById('account-carousel');
  if (!carousel || !clientConti.length) return;
  if (index < 0 || index >= clientConti.length) return;

  activeContoIndex = index;
  activeContoId = clientConti[index].id;
  updateAccountDots();

  carousel.scrollTo({
    left: index * carousel.clientWidth,
    behavior: 'smooth'
  });

  if (!keepData) {
    showAllMovimenti = false;
    loadActiveContoData();
  }
}

function updateAccountDots() {
  const dots = document.querySelectorAll('#account-dots .account-dot');
  dots.forEach((dot, index) => dot.classList.toggle('active', index === activeContoIndex));
}

async function loadActiveContoData() {
  if (!currentUser || !activeContoId) return;

  try {
    const movimenti = await api(`/api/client/${currentUser.id}/conti/${activeContoId}/movimenti`);
    clientMovimentiCache = movimenti;
    renderClientMovimenti();

    const riepilogo = await api(`/api/client/${currentUser.id}/conti/${activeContoId}/riepilogo`);
    renderAnalisi(riepilogo);
  } catch (err) {
    console.error(err);
  }
}

function renderMovimenti(movimenti, containerId, showDelete) {
  const c = document.getElementById(containerId);
  movimentoById.clear();

  if (movimenti.length === 0) {
    c.innerHTML = '<div class="movimenti-empty">Nessun movimento</div>';
    return;
  }

  c.innerHTML = movimenti.map(m => {
    movimentoById.set(m.id, m);
    const icon = getMovIcon(m.tipo, m.categoria);
    const amountSign = m.tipo === 'addebito' ? '-' : '';
    const stato = m.stato === 'in_corso' ? '<span class="mov-stato">IN CORSO</span>' : '';
    const amountColor = m.tipo === 'accredito' ? 'tipo-accredito' : '';
    const delBtn = showDelete ? `<button class="mov-delete-btn" onclick="event.stopPropagation();confirmDeleteMovimento(${m.id})"><span class="material-icons-round">close</span></button>` : '';

    return `
      <div class="mov-item" onclick="openMovimentoDettaglio(${m.id})">
        <div class="mov-icon-wrap tipo-${m.tipo}">
          <span class="material-icons-round">${icon}</span>
        </div>
        <div class="mov-info">
          <div class="mov-date">${fmtDate(m.data)}</div>
          <div class="mov-desc">${escHtml(m.descrizione)}</div>
        </div>
        <div class="mov-right">
          ${stato}
          <span class="mov-amount ${amountColor}">
            ${amountSign}${fmt(m.importo)} €
            <span class="material-icons-round">chevron_right</span>
          </span>
        </div>
        ${delBtn}
      </div>
    `;
  }).join('');
}

function openMovimentoDettaglio(movId) {
  const mov = movimentoById.get(movId);
  if (!mov) return;

  movimentoDetailOriginScreen = getActiveScreenId();

  const importoSegno = mov.tipo === 'accredito' ? '+' : '-';
  const categoria = (mov.categoria || 'Altro').toUpperCase();
  const dayLabel = fmtDate(mov.data);
  const icon = getMovIcon(mov.tipo, mov.categoria);

  const iconEl = document.getElementById('det-page-icon');
  if (iconEl) iconEl.textContent = icon;

  document.getElementById('det-page-category').textContent = categoria;
  document.getElementById('det-page-importo').textContent = `${importoSegno}${fmt(mov.importo)} €`;
  document.getElementById('det-page-descrizione').textContent = mov.descrizione || '-';
  document.getElementById('det-page-day').textContent = dayLabel;
  document.getElementById('det-page-extra').textContent = `Tipo: ${mov.tipo} • Stato: ${mov.stato} • Data: ${fmtDateTime(mov.data)}`;

  showScreen('movimento-detail-screen');
}

function backFromMovimentoDettaglio() {
  showScreen(movimentoDetailOriginScreen || 'dashboard-screen');
}

function renderAnalisi(data) {
  document.getElementById('analisi-entrate').textContent = `${fmt(data.entrate)} €`;
  document.getElementById('analisi-uscite').textContent = `-${fmt(data.uscite)} €`;

  const maxVal = Math.max(data.entrate, data.uscite, 1);
  const entrateBar = document.querySelector('#bar-entrate div');
  const usciteBar = document.querySelector('#bar-uscite div');

  setTimeout(() => {
    entrateBar.style.width = `${(data.entrate / maxVal) * 100}%`;
    usciteBar.style.width = `${(data.uscite / maxVal) * 100}%`;
  }, 100);
}

// ==================== ADMIN ====================
async function loadAdminDashboard() {
  try {
    const clienti = await api('/api/admin/clienti');
    renderAdminClients(clienti);
  } catch (err) {
    console.error(err);
  }
}

function renderAdminClients(clienti) {
  const c = document.getElementById('admin-clienti-list');
  if (clienti.length === 0) {
    c.innerHTML = '<div class="movimenti-empty">Nessun cliente</div>';
    return;
  }

  c.innerHTML = clienti.map(cl => {
    const initials = (cl.nome[0] + cl.cognome[0]).toUpperCase();
    return `
      <div class="admin-client-card" onclick="selectClient(${cl.id})">
        <div class="admin-avatar">${initials}</div>
        <div class="admin-client-info">
          <div class="admin-client-name">${escHtml(cl.nome)} ${escHtml(cl.cognome)}</div>
          <div class="admin-client-pin">PIN: ${cl.pin} • ${cl.conto}</div>
        </div>
        <div class="admin-client-saldo">${fmt(cl.saldo)} €</div>
        <button class="admin-client-del" onclick="event.stopPropagation();confirmDeleteClient(${cl.id},'${escHtml(cl.nome)} ${escHtml(cl.cognome)}')">
          <span class="material-icons-round">delete</span>
        </button>
      </div>
    `;
  }).join('');
}

async function selectClient(id) {
  selectedClientId = id;
  try {
    const cl = await api(`/api/client/${id}`);
    adminConti = await api(`/api/admin/clienti/${id}/conti`);
    adminActiveContoId = adminConti.length ? adminConti[0].id : null;

    const initials = (cl.nome[0] + cl.cognome[0]).toUpperCase();
    document.getElementById('admin-detail-initials').textContent = initials;
    document.getElementById('admin-detail-nome').textContent = `${cl.nome} ${cl.cognome}`;
    document.getElementById('admin-detail-pin').textContent = `PIN: ${cl.pin}`;

    renderAdminContoSelect();
    await loadAdminActiveContoData();

    document.getElementById('admin-clienti-view').classList.add('hidden');
    document.getElementById('admin-client-detail').classList.remove('hidden');
  } catch (err) {
    showToast('Errore caricamento');
  }
}

function renderAdminContoSelect() {
  const sel = document.getElementById('admin-conto-select');
  if (!sel) return;

  sel.innerHTML = adminConti
    .map(c => `<option value="${c.id}" ${c.id === adminActiveContoId ? 'selected' : ''}>${escHtml(c.iban)} • ${escHtml(c.conto)}</option>`)
    .join('');

  updateSecondContoButtonState();
}

function updateSecondContoButtonState() {
  const btn = document.getElementById('btn-add-second-conto');
  if (!btn) return;

  const canAdd = adminConti.length < 2;
  btn.disabled = !canAdd;
  btn.textContent = canAdd ? 'Aggiungi secondo conto' : 'Secondo conto già presente';
}

async function onAdminContoChange() {
  const sel = document.getElementById('admin-conto-select');
  if (!sel) return;
  adminActiveContoId = parseInt(sel.value);
  await loadAdminActiveContoData();
}

async function loadAdminActiveContoData() {
  if (!selectedClientId || !adminActiveContoId) return;

  const conto = adminConti.find(c => c.id === adminActiveContoId);
  if (conto) {
    document.getElementById('admin-detail-conto').textContent = `Conto: ${conto.conto}`;
    document.getElementById('admin-detail-iban').textContent = conto.iban;
    document.getElementById('admin-detail-saldo').textContent = `€ ${fmt(conto.saldo)}`;
    const ibanInput = document.getElementById('admin-iban-input');
    if (ibanInput) ibanInput.value = conto.iban;
  }

  const movimenti = await api(`/api/admin/clienti/${selectedClientId}/conti/${adminActiveContoId}/movimenti`);
  renderMovimenti(movimenti, 'admin-movimenti-list', true);
}

async function refreshAdminConti(keepContoId = null) {
  if (!selectedClientId) return;
  adminConti = await api(`/api/admin/clienti/${selectedClientId}/conti`);
  if (keepContoId && adminConti.some(c => c.id === keepContoId)) {
    adminActiveContoId = keepContoId;
  } else {
    adminActiveContoId = adminConti.length ? adminConti[0].id : null;
  }
  renderAdminContoSelect();
}

async function saveAdminIban() {
  if (!selectedClientId || !adminActiveContoId) return showToast('Seleziona un conto');
  const ibanInput = document.getElementById('admin-iban-input');
  const iban = ibanInput ? ibanInput.value.trim().toUpperCase() : '';
  if (!iban) return showToast('Inserisci un IBAN');

  try {
    await api(`/api/admin/clienti/${selectedClientId}/conti/${adminActiveContoId}/iban`, 'PUT', { iban });
    await refreshAdminConti(adminActiveContoId);
    await loadAdminActiveContoData();
    showToast('IBAN aggiornato');
  } catch (err) {
    showToast(err.message || 'Errore aggiornamento IBAN');
  }
}

function showAddSecondContoModal() {
  if (adminConti.length >= 2) {
    showToast('Il cliente ha già due conti');
    return;
  }

  const ibanInput = document.getElementById('second-conto-iban');
  const saldoInput = document.getElementById('second-conto-saldo');
  if (ibanInput) ibanInput.value = '';
  if (saldoInput) saldoInput.value = '0';
  document.getElementById('modal-add-second-conto').classList.remove('hidden');
}

async function createSecondContoAdmin() {
  if (!selectedClientId) return;

  if (adminConti.length >= 2) {
    showToast('Il cliente ha già due conti');
    return;
  }

  const ibanInput = document.getElementById('second-conto-iban');
  const saldoInput = document.getElementById('second-conto-saldo');
  const ibanProposto = ibanInput ? ibanInput.value.trim() : '';
  const saldoIniziale = saldoInput ? parseFloat(saldoInput.value || '0') : 0;

  try {
    const data = await api(`/api/admin/clienti/${selectedClientId}/conti`, 'POST', {
      iban: ibanProposto || undefined,
      saldo_iniziale: isNaN(saldoIniziale) ? 0 : saldoIniziale
    });
    closeModal('modal-add-second-conto');
    await refreshAdminConti(data.conto.id);
    await loadAdminActiveContoData();
    showToast('Secondo conto aggiunto');
  } catch (err) {
    showToast(err.message || 'Errore creazione conto');
  }
}

function backToClientList() {
  selectedClientId = null;
  document.getElementById('admin-client-detail').classList.add('hidden');
  document.getElementById('admin-clienti-view').classList.remove('hidden');
  loadAdminDashboard();
}

// ==================== ADMIN ACTIONS ====================
function showAddClientModal() {
  document.getElementById('new-client-nome').value = '';
  document.getElementById('new-client-cognome').value = '';
  document.getElementById('new-client-saldo').value = '';
  document.getElementById('modal-add-client').classList.remove('hidden');
}

async function addClient() {
  const nome = document.getElementById('new-client-nome').value.trim();
  const cognome = document.getElementById('new-client-cognome').value.trim();
  const saldo = document.getElementById('new-client-saldo').value;
  if (!nome || !cognome) return showToast('Inserisci nome e cognome');
  try {
    const data = await api('/api/admin/clienti', 'POST', { nome, cognome, saldo_iniziale: parseFloat(saldo) || 0 });
    closeModal('modal-add-client');
    showToast(`Cliente creato! PIN: ${data.cliente.pin}`);
    loadAdminDashboard();
  } catch (err) {
    showToast('Errore creazione');
  }
}

function confirmDeleteClient(id, nome) {
  document.getElementById('confirm-title').textContent = 'Elimina Cliente';
  document.getElementById('confirm-text').textContent = `Eliminare ${nome}? Azione irreversibile.`;
  document.getElementById('btn-confirm-action').onclick = async () => {
    try {
      await api(`/api/admin/clienti/${id}`, 'DELETE');
      closeModal('modal-confirm');
      showToast('Cliente eliminato');
      loadAdminDashboard();
    } catch (err) { showToast('Errore'); }
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

function showAddMovimentoModal() {
  document.getElementById('mov-tipo').value = 'addebito';
  document.getElementById('mov-importo').value = '';
  document.getElementById('mov-descrizione').value = '';
  document.getElementById('mov-categoria').value = 'Pagamento';
  document.getElementById('mov-stato').value = 'completato';
  document.getElementById('modal-add-movimento').classList.remove('hidden');
}

async function addMovimento() {
  const tipo = document.getElementById('mov-tipo').value;
  const importo = document.getElementById('mov-importo').value;
  const descrizione = document.getElementById('mov-descrizione').value.trim();
  const categoria = document.getElementById('mov-categoria').value;
  const stato = document.getElementById('mov-stato').value;
  if (!importo || !descrizione) return showToast('Compila tutti i campi');
  if (parseFloat(importo) <= 0) return showToast("L'importo deve essere > 0");
  if (!adminActiveContoId) return showToast('Seleziona un conto');
  try {
    await api(`/api/admin/clienti/${selectedClientId}/movimenti`, 'POST', { tipo, importo: parseFloat(importo), descrizione, categoria, stato, conto_id: adminActiveContoId });
    closeModal('modal-add-movimento');
    showToast('Movimento aggiunto');
    await refreshAdminConti(adminActiveContoId);
    await loadAdminActiveContoData();
  } catch (err) { showToast('Errore'); }
}

function confirmDeleteMovimento(movId) {
  document.getElementById('confirm-title').textContent = 'Elimina Movimento';
  document.getElementById('confirm-text').textContent = 'Eliminare questo movimento? Il saldo verrà ricalcolato.';
  document.getElementById('btn-confirm-action').onclick = async () => {
    try {
      await api(`/api/admin/movimenti/${movId}`, 'DELETE');
      closeModal('modal-confirm');
      showToast('Movimento eliminato');
      await refreshAdminConti(adminActiveContoId);
      await loadAdminActiveContoData();
    } catch (err) { showToast('Errore'); }
  };
  document.getElementById('modal-confirm').classList.remove('hidden');
}

// ==================== INIT ====================
updateTime();
setInterval(updateTime, 30000);
