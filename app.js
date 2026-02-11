// --- State Management ---
let state = {
    queue: JSON.parse(localStorage.getItem('vanilla_queue')) || [],
    ticketCounter: parseInt(localStorage.getItem('vanilla_counter')) || 100,
    activeCustomerId: localStorage.getItem('vanilla_active_id') || null,
    view: 'join' // join, status, staff, login, kiosk
};

function saveState() {
    localStorage.setItem('vanilla_queue', JSON.stringify(state.queue));
    localStorage.setItem('vanilla_counter', state.ticketCounter.toString());
    localStorage.setItem('vanilla_active_id', state.activeCustomerId || '');
}

// --- Auth Management ---
function isAuthenticated() {
    return sessionStorage.getItem('staff_auth') === 'true';
}

// --- DOM Elements ---
const views = {
    join: document.getElementById('join-view'),
    status: document.getElementById('status-view'),
    staff: document.getElementById('staff-view'),
    login: document.getElementById('login-view'),
    kiosk: document.getElementById('kiosk-view')
};

const navElements = {
    backBtn: document.getElementById('back-btn'),
    staffBtn: document.getElementById('staff-portal-btn'),
    kioskBtn: document.getElementById('kiosk-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    logo: document.getElementById('logo-btn'),
    nav: document.getElementById('main-nav')
};

const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const joinForm = document.getElementById('join-form');
const serviceOpts = document.querySelectorAll('.service-opt');
const statusContainer = document.getElementById('status-card-container');
const queueList = document.getElementById('queue-list');
const historyList = document.getElementById('history-list');
const servingContainer = document.getElementById('now-serving-container');
const callNextBtn = document.getElementById('call-next-btn');

// --- Initialization ---
function init() {
    renderView();
    requestNotificationPermission();

    // Add periodic refresh to simulate "real-time" if multiple tabs are open
    window.addEventListener('storage', (e) => {
        if (e.key.startsWith('vanilla_')) {
            const data = JSON.parse(localStorage.getItem('vanilla_queue')) || [];
            state.queue = data;
            state.ticketCounter = parseInt(localStorage.getItem('vanilla_counter')) || 100;
            state.activeCustomerId = localStorage.getItem('vanilla_active_id') || null;
            renderView();
        }
    });

    // Start timer for "real-time" position updates if in status view
    setInterval(() => {
        if (state.view === 'status' || state.view === 'staff') {
            renderView();
        }
    }, 10000);
}

function formatDuration(ms) {
    if (!ms || ms < 0) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// --- Service Selection Logic ---
let selectedService = "General Inquiry";
serviceOpts.forEach(opt => {
    opt.addEventListener('click', () => {
        serviceOpts.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedService = opt.dataset.service;
    });
});

// --- Navigation Logic ---
function setView(viewName) {
    if (viewName === 'staff' && !isAuthenticated()) {
        state.view = 'login';
    } else {
        state.view = viewName;
    }

    // Exit kiosk mode class if moving away
    if (state.view !== 'kiosk') {
        document.body.classList.remove('kiosk-mode');
    } else {
        document.body.classList.add('kiosk-mode');
        generateKioskQR();
    }

    renderView();
}

navElements.staffBtn.addEventListener('click', () => setView('staff'));
navElements.kioskBtn.addEventListener('click', () => setView('kiosk'));
navElements.logo.addEventListener('click', () => setView('join'));
navElements.backBtn.addEventListener('click', () => {
    if (state.activeCustomerId) setView('status');
    else setView('join');
});
navElements.logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('staff_auth');
    setView('join');
});
document.getElementById('exit-kiosk-btn').addEventListener('click', () => setView('join'));

// --- Login Logic ---
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pass = document.getElementById('staff-password').value;
    if (pass === 'admin123') {
        sessionStorage.setItem('staff_auth', 'true');
        loginError.classList.add('hidden');
        setView('staff');
    } else {
        loginError.classList.remove('hidden');
    }
});

// --- View Rendering ---
function renderView() {
    // Toggle active view
    Object.keys(views).forEach(v => {
        views[v].classList.toggle('active', state.view === v);
    });

    // Toggle nav buttons
    navElements.backBtn.classList.toggle('hidden', state.view === 'join' || state.view === 'kiosk');
    navElements.staffBtn.classList.toggle('hidden', state.view === 'staff' || state.view === 'login');
    navElements.kioskBtn.classList.toggle('hidden', state.view === 'kiosk');
    navElements.logoutBtn.classList.toggle('hidden', !isAuthenticated() || state.view === 'kiosk' || state.view === 'login');

    if (state.view === 'status') renderStatusView();
    if (state.view === 'staff') renderStaffView();

    // Refresh Lucide icons for dynamic content
    if (window.lucide) window.lucide.createIcons();
}

// --- Join Logic ---
joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('customer-name').value;

    const newCustomer = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        service: selectedService,
        joinedAt: Date.now(),
        status: 'waiting',
        ticketNumber: state.ticketCounter + 1
    };

    state.queue.push(newCustomer);
    state.ticketCounter++;
    state.activeCustomerId = newCustomer.id;
    state.view = 'status';

    saveState();
    renderView();
});

// --- QR Generation for Kiosk ---
let kioskQrInstance = null;
function generateKioskQR() {
    const qrContainer = document.getElementById('kiosk-qr-code');
    qrContainer.innerHTML = '';

    // Get base URL without hash or query params to ensure scan leads to Join page
    const url = window.location.origin + window.location.pathname;

    new QRCode(qrContainer, {
        text: url,
        width: 300,
        height: 300,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

// --- Status View Rendering ---
function renderStatusView() {
    const customer = state.queue.find(c => c.id === state.activeCustomerId);
    if (!customer) {
        statusContainer.innerHTML = `<div class="glass-card"><h2>Ticket not found</h2><button onclick="setView('join')" class="btn-primary">Join Queue</button></div>`;
        return;
    }

    const waitingQueue = state.queue.filter(c => c.status === 'waiting' || c.status === 'called');
    const index = waitingQueue.findIndex(c => c.id === customer.id);
    const position = index;

    const isCalled = customer.status === 'called';
    const isCompleted = customer.status === 'completed';

    statusContainer.innerHTML = `
        <div class="glass-card status-card animate-fade-in">
            ${isCalled ? '<div class="turn-banner">IT\'S YOUR TURN! PROCEED TO COUNTER</div>' : ''}
            <div class="header-section" style="margin-top: ${isCalled ? '1.5rem' : '0'}">
                <p class="subtitle">Your Ticket Number</p>
                <div class="ticket-hero">
                    <h1>#${customer.ticketNumber}</h1>
                </div>
                <h3 style="color: var(--primary)">${customer.name}</h3>
            </div>

            <div class="pos-wait-grid">
                <div class="glass-card mini-stat">
                    <i data-lucide="map-pin"></i>
                    <p style="font-size: 0.75rem; color: var(--text-muted)">Position</p>
                    <h3>${position === 0 ? 'Next' : (position > 0 ? position + ' ahead' : 'Served')}</h3>
                </div>
                <div class="glass-card mini-stat">
                    <i data-lucide="clock"></i>
                    <p style="font-size: 0.75rem; color: var(--text-muted)">Est. Wait</p>
                    <h3>${position * 15}m</h3>
                </div>
            </div>

            <div class="qr-placeholder" id="ticket-qr"></div>

            <p class="subtitle" style="font-size: 0.875rem">Service: <strong>${customer.service}</strong></p>
            
            ${isCompleted ? `
                <div style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10;">
                    <i data-lucide="check-circle-2" size="64" color="var(--success)"></i>
                    <h2>Service Completed</h2>
                    <p class="subtitle">Thank you for using our smart queue!</p>
                    <button onclick="localStorage.removeItem('vanilla_active_id'); location.reload();" class="btn-primary" style="margin-top: 2rem">Join New Queue</button>
                </div>
            ` : ''}
        </div>
    `;

    // Generate specific ticket QR
    new QRCode(document.getElementById('ticket-qr'), {
        text: customer.id,
        width: 140,
        height: 140,
        colorDark: "#0f172a",
        colorLight: "#ffffff"
    });
}

// --- Staff View Rendering ---
function renderStaffView() {
    const waitingList = state.queue.filter(c => c.status === 'waiting');
    const historyData = state.queue.filter(c => c.status === 'completed' || c.status === 'cancelled').reverse();
    const servedCount = state.queue.filter(c => c.status === 'completed').length;
    const currentServing = state.queue.find(c => c.status === 'called');

    // Stats
    document.getElementById('stat-waiting').textContent = waitingList.length;
    document.getElementById('stat-served').textContent = servedCount;
    callNextBtn.disabled = waitingList.length === 0;

    // Queue List
    queueList.innerHTML = waitingList.length === 0 ? '<p class="subtitle" style="text-align: center; padding: 2rem;">No customers waiting.</p>' : '';
    waitingList.forEach(c => {
        const card = document.createElement('div');
        card.className = 'glass-card customer-card animate-fade-in';
        card.innerHTML = `
            <div>
                <span class="ticket-tag">#${c.ticketNumber}</span>
                <h4>${c.name}</h4>
                <p class="subtitle" style="font-size: 0.75rem">${c.service}</p>
            </div>
            <button onclick="cancelTicket('${c.id}')" class="btn-text" style="color: var(--danger)">
                <i data-lucide="x-circle"></i>
            </button>
        `;
        queueList.appendChild(card);
    });

    // History List
    historyList.innerHTML = historyData.length === 0 ? '<p class="subtitle" style="text-align: center; padding: 2rem;">No history yet.</p>' : '';
    historyData.forEach(c => {
        const waitTime = c.calledAt ? (c.calledAt - c.joinedAt) : (c.finishedAt - c.joinedAt);
        const card = document.createElement('div');
        card.className = 'glass-card customer-card animate-fade-in';
        card.innerHTML = `
            <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <span class="ticket-tag">#${c.ticketNumber}</span>
                    <span class="status-badge status-${c.status}">${c.status}</span>
                </div>
                <h4>${c.name}</h4>
                <p class="subtitle" style="font-size: 0.75rem">${c.service}</p>
            </div>
            <div style="text-align: right;">
                <p class="subtitle" style="font-size: 0.7rem; margin-bottom: 2px;">Wait Time</p>
                <p style="font-weight: 600; font-size: 0.9rem; color: var(--secondary)">${formatDuration(waitTime)}</p>
            </div>
        `;
        historyList.appendChild(card);
    });

    // Now Serving
    if (currentServing) {
        servingContainer.innerHTML = `
            <div class="glass-card serving-card animate-fade-in">
                <p style="color: var(--primary); font-weight: 700; font-size: 0.75rem; letter-spacing: 0.1em;">NOW SERVING</p>
                <h1>#${currentServing.ticketNumber}</h1>
                <h3>${currentServing.name}</h3>
                <p class="subtitle">${currentServing.service}</p>
                <button onclick="completeCustomer('${currentServing.id}')" class="btn-primary" style="width: 100%; margin-top: 2rem; background: var(--success); justify-content: center;">
                    <i data-lucide="check-circle"></i> Mark as Completed
                </button>
            </div>
        `;
    } else {
        servingContainer.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 2rem; color: var(--text-muted)">
                <p>No active service.</p>
                <p style="font-size: 0.75rem; margin-top: 0.5rem">Click "Call Next" to start.</p>
            </div>
        `;
    }
}

// --- Actions ---
function callNext() {
    const next = state.queue.find(c => c.status === 'waiting');
    if (next) {
        state.queue = state.queue.map(c =>
            c.id === next.id ? { ...c, status: 'called', calledAt: Date.now() } :
                (c.status === 'called' ? { ...c, status: 'completed', finishedAt: Date.now() } : c)
        );
        saveState();
        renderView();
        announceTicket(next.ticketNumber, next.name);
        sendNotification(next);
    }
}

callNextBtn.addEventListener('click', callNext);

function completeCustomer(id) {
    state.queue = state.queue.map(c => c.id === id ? { ...c, status: 'completed', finishedAt: Date.now() } : c);
    saveState();
    renderView();
}

function cancelTicket(id) {
    state.queue = state.queue.map(c => c.id === id ? { ...c, status: 'cancelled', finishedAt: Date.now() } : c);
    if (state.activeCustomerId === id) state.activeCustomerId = null;
    saveState();
    renderView();
}

// --- Audio API (Speech) ---
function announceTicket(number, name) {
    if ('speechSynthesis' in window) {
        const msg = new SpeechSynthesisUtterance();
        msg.text = `Ticket number ${number}, ${name}, please proceed to the counter.`;
        msg.rate = 0.9;
        msg.pitch = 1;
        window.speechSynthesis.speak(msg);
    }
}

// --- Notification API ---
function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission();
    }
}

function sendNotification(customer) {
    if ('Notification' in window && Notification.permission === 'granted' && state.activeCustomerId === customer.id) {
        new Notification('Your Turn!', {
            body: `Hello ${customer.name}, Ticket #${customer.ticketNumber} is now being served.`,
            icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209101.png'
        });
    }
}

// Global exposure for onclick handlers
window.cancelTicket = cancelTicket;
window.completeCustomer = completeCustomer;
window.setView = setView;

init();
