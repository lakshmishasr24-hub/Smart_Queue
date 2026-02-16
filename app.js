// --- Supabase Configuration ---
const SUPABASE_URL = 'https://klpalrdvinfmvlsopapa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtscGFscmR2aW5mbXZsc29wYXBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3Nzk3NDEsImV4cCI6MjA4NjM1NTc0MX0.pMg4DnATZ0290feV2pN_TPYmhnp4Xc5-qB3aVQpY9N0';

let supabaseClient;
try {
    // The library defines a global 'supabase' object with a 'createClient' method
    if (window.supabase && window.supabase.createClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
        console.error("Supabase library not found on window object.");
    }
} catch (e) {
    console.error("Supabase fail to initialize:", e);
}

// --- State Management ---
let state = {
    queue: [],
    activeCustomerId: localStorage.getItem('vanilla_active_id') || null,
    view: 'join', // join, status, staff, login, kiosk
    isCustomerMode: new URLSearchParams(window.location.search).get('mode') === 'customer'
};

// --- Auth Management ---
function isAuthenticated() {
    return sessionStorage.getItem('staff_auth') === 'true';
}

// --- Helper Functions ---
function formatDuration(ms) {
    if (!ms || ms < 0) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// --- View Utility ---
function setView(viewName) {
    if (viewName === 'staff' && !isAuthenticated()) {
        state.view = 'login';
    } else {
        state.view = viewName;
    }

    if (state.view !== 'kiosk') {
        document.body.classList.remove('kiosk-mode');
    } else {
        document.body.classList.add('kiosk-mode');
        generateKioskQR();
    }

    renderView();
}

// --- Supabase Data Logic ---
async function fetchInitialData() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('queue')
            .select('*')
            .order('joined_at', { ascending: true });

        if (error) throw error;
        state.queue = data || [];
    } catch (err) {
        console.error('Error fetching initial data:', err);
    }
}

function setupRealtimeSubscription() {
    if (!supabaseClient) return;
    supabaseClient
        .channel('public:queue')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'queue' }, async (payload) => {
            console.log('Realtime update:', payload);
            await fetchInitialData();
            renderView();

            if (payload.eventType === 'UPDATE' && payload.new.status === 'called') {
                const isMyTurn = payload.new.id === state.activeCustomerId;
                const isStaff = isAuthenticated();
                const isKiosk = state.view === 'kiosk';

                // Announce for Staff, Kiosk, or the specific Customer
                if (isMyTurn || isStaff || isKiosk) {
                    announceTicket(payload.new.ticket_number, payload.new.name, payload.new.service);
                }

                // Only send desktop notification to the specific Customer
                if (isMyTurn) {
                    sendNotification(payload.new);
                }
            }
        })
        .subscribe();
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Attach Listeners first (Non-data dependent)
    attachEventListeners();

    // 2. Initial Render (with empty or local state)
    renderView();

    // 3. Request Permissions
    requestNotificationPermission();

    // 4. Fetch Data & Start Real-Time
    try {
        await fetchInitialData();
        setupRealtimeSubscription();
        renderView(); // Render again with data
    } catch (e) {
        console.error("Data init failed:", e);
    }

    // 5. Start Refresh Timer
    setInterval(() => {
        if (state.view === 'status' || state.view === 'staff') {
            renderView();
        }
    }, 30000);
});

function attachEventListeners() {
    const navElements = {
        backBtn: document.getElementById('back-btn'),
        staffBtn: document.getElementById('staff-portal-btn'),
        kioskBtn: document.getElementById('kiosk-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        logo: document.getElementById('logo-btn'),
        exitKiosk: document.getElementById('exit-kiosk-btn')
    };

    if (navElements.staffBtn) navElements.staffBtn.onclick = () => setView('staff');
    if (navElements.kioskBtn) navElements.kioskBtn.onclick = () => setView('kiosk');
    if (navElements.logo) navElements.logo.onclick = () => setView('join');
    if (navElements.backBtn) navElements.backBtn.onclick = () => {
        if (state.activeCustomerId) setView('status');
        else setView('join');
    };
    if (navElements.logoutBtn) navElements.logoutBtn.onclick = () => {
        sessionStorage.removeItem('staff_auth');
        setView('join');
    };
    if (navElements.exitKiosk) navElements.exitKiosk.onclick = () => setView('join');

    // Service Selection
    const serviceOpts = document.querySelectorAll('.service-opt');
    serviceOpts.forEach(opt => {
        opt.onclick = () => {
            serviceOpts.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            window.selectedService = opt.dataset.service;
        };
    });
    window.selectedService = "General Inquiry";

    // Forms
    const joinForm = document.getElementById('join-form');
    if (joinForm) {
        joinForm.onsubmit = async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('customer-name');
            const name = nameInput ? nameInput.value : "Unknown";

            const lastTicket = state.queue.reduce((max, item) => Math.max(max, item.ticket_number || 100), 100);

            if (!supabaseClient) {
                alert("Database disconnected. Check connection.");
                return;
            }

            const { data, error } = await supabaseClient
                .from('queue')
                .insert([{
                    name,
                    service: window.selectedService,
                    ticket_number: lastTicket + 1,
                    status: 'waiting',
                    joined_at: new Date().toISOString()
                }])
                .select();

            if (error) {
                console.error('Join error:', error);
            } else if (data && data[0]) {
                state.activeCustomerId = data[0].id;
                localStorage.setItem('vanilla_active_id', data[0].id);
                setView('status');
            }
        };
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.onsubmit = (e) => {
            e.preventDefault();
            const passInput = document.getElementById('staff-password');
            const errorText = document.getElementById('login-error');
            if (passInput && passInput.value === 'admin123') {
                sessionStorage.setItem('staff_auth', 'true');
                if (errorText) errorText.classList.add('hidden');
                setView('staff');
            } else if (errorText) {
                errorText.classList.remove('hidden');
            }
        };
    }

    const callNextBtn = document.getElementById('call-next-btn');
    if (callNextBtn) {
        callNextBtn.onclick = () => {
            console.log('Call Next button clicked');
            window.callNext();
        };
    }
}

// --- UI Rendering ---
function renderView() {
    const views = ['join', 'status', 'staff', 'login', 'kiosk'];
    views.forEach(v => {
        const el = document.getElementById(`${v}-view`);
        if (el) el.classList.toggle('active', state.view === v);
    });

    const navItems = {
        back: document.getElementById('back-btn'),
        staff: document.getElementById('staff-portal-btn'),
        kiosk: document.getElementById('kiosk-btn'),
        logout: document.getElementById('logout-btn')
    };

    if (navItems.back) navItems.back.classList.toggle('hidden', state.view === 'join' || state.view === 'kiosk');

    // Management buttons visibility
    const showManagement = !state.isCustomerMode && (state.view !== 'staff' && state.view !== 'login');
    if (navItems.staff) navItems.staff.classList.toggle('hidden', !showManagement);
    if (navItems.kiosk) navItems.kiosk.classList.toggle('hidden', !showManagement || state.view === 'kiosk');

    if (navItems.logout) navItems.logout.classList.toggle('hidden', !isAuthenticated() || state.view === 'kiosk' || state.view === 'login');

    if (state.view === 'status') renderStatusView();
    if (state.view === 'staff') renderStaffView();

    if (window.lucide) window.lucide.createIcons();
}

function renderStatusView() {
    const container = document.getElementById('status-card-container');
    if (!container) return;

    const customer = state.queue.find(c => c.id === state.activeCustomerId);
    if (!customer) {
        container.innerHTML = `<div class="glass-card"><h2>Ticket not found</h2><button onclick="setView('join')" class="btn-primary">Join Queue</button></div>`;
        return;
    }

    const waitingQueue = state.queue.filter(c => c.status === 'waiting' || c.status === 'called');
    const index = waitingQueue.findIndex(c => c.id === customer.id);
    const position = index;

    const isCalled = customer.status === 'called';
    const isCompleted = customer.status === 'completed';

    container.innerHTML = `
        <div class="glass-card status-card animate-fade-in">
            ${isCalled ? '<div class="turn-banner">IT\'S YOUR TURN! PROCEED TO COUNTER</div>' : ''}
            <div class="header-section" style="margin-top: ${isCalled ? '1.5rem' : '0'}">
                <p class="subtitle">Your Ticket Number</p>
                <div class="ticket-hero">
                    <h1>#${customer.ticket_number}</h1>
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

    const qrEl = document.getElementById('ticket-qr');
    if (qrEl) {
        new QRCode(qrEl, { text: customer.id, width: 140, height: 140, colorDark: "#0f172a", colorLight: "#ffffff" });
    }
}

function renderStaffView() {
    const waitingList = state.queue.filter(c => c.status === 'waiting');
    const historyData = state.queue.filter(c => c.status === 'completed' || c.status === 'cancelled').reverse();
    const servedCount = state.queue.filter(c => c.status === 'completed').length;
    const currentServing = state.queue.find(c => c.status === 'called');

    const statWaiting = document.getElementById('stat-waiting');
    const statServed = document.getElementById('stat-served');
    const callNextBtn = document.getElementById('call-next-btn');

    if (statWaiting) statWaiting.textContent = waitingList.length;
    if (statServed) statServed.textContent = servedCount;
    if (callNextBtn) {
        console.log('Rendering staff view. Waiting count:', waitingList.length);
        callNextBtn.disabled = waitingList.length === 0;
    }

    const qListEl = document.getElementById('queue-list');
    const histListEl = document.getElementById('history-list');
    const servingEl = document.getElementById('now-serving-container');

    if (qListEl) {
        qListEl.innerHTML = waitingList.length === 0 ? '<p class="subtitle" style="text-align: center; padding: 2rem;">No customers waiting.</p>' : '';
        waitingList.forEach(c => {
            const card = document.createElement('div');
            card.className = 'glass-card customer-card animate-fade-in';
            card.innerHTML = `<div><span class="ticket-tag">#${c.ticket_number}</span><h4>${c.name}</h4><p class="subtitle" style="font-size: 0.75rem">${c.service}</p></div>
                <button onclick="cancelTicket('${c.id}')" class="btn-text" style="color: var(--danger)"><i data-lucide="x-circle"></i></button>`;
            qListEl.appendChild(card);
        });
    }

    if (histListEl) {
        histListEl.innerHTML = historyData.length === 0 ? '<p class="subtitle" style="text-align: center; padding: 2rem;">No history yet.</p>' : '';
        historyData.forEach(c => {
            const start = new Date(c.joined_at).getTime();
            const end = c.called_at ? new Date(c.called_at).getTime() : new Date(c.finished_at).getTime();
            const waitTime = isNaN(start) || isNaN(end) ? 0 : end - start;

            const card = document.createElement('div');
            card.className = 'glass-card customer-card animate-fade-in';
            card.innerHTML = `
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                        <span class="ticket-tag">#${c.ticket_number}</span>
                        <span class="status-badge status-${c.status}">${c.status}</span>
                    </div>
                    <h4>${c.name}</h4>
                    <p class="subtitle" style="font-size: 0.75rem">${c.service}</p>
                </div>
                <div style="text-align: right;">
                    <p class="subtitle" style="font-size: 0.7rem; margin-bottom: 2px;">Wait Time</p>
                    <p style="font-weight: 600; font-size: 0.9rem; color: var(--secondary)">${formatDuration(waitTime)}</p>
                </div>`;
            histListEl.appendChild(card);
        });
    }

    if (servingEl) {
        if (currentServing) {
            servingEl.innerHTML = `
                <div class="glass-card serving-card animate-fade-in">
                    <p style="color: var(--primary); font-weight: 700; font-size: 0.75rem; letter-spacing: 0.1em;">NOW SERVING</p>
                    <h1>#${currentServing.ticket_number}</h1>
                    <h3>${currentServing.name}</h3>
                    <p class="subtitle">${currentServing.service}</p>
                    <button onclick="completeCustomer('${currentServing.id}')" class="btn-primary" style="width: 100%; margin-top: 2rem; background: var(--success); justify-content: center;">
                        <i data-lucide="check-circle"></i> Mark as Completed
                    </button>
                </div>`;
        } else {
            servingEl.innerHTML = `<div class="glass-card" style="text-align: center; padding: 2rem; color: var(--text-muted)"><p>No active service.</p><p style="font-size: 0.75rem; margin-top: 0.5rem">Click "Call Next" to start.</p></div>`;
        }
    }
}

// --- Actions (Global exposure) ---
window.callNext = async () => {
    console.log('Starting callNext operation...');
    if (!supabaseClient) {
        console.error('Supabase client not initialized');
        alert("System not connected to database.");
        return;
    }

    const next = state.queue.find(c => c.status === 'waiting');
    console.log('Next customer found:', next);

    if (next) {
        try {
            // 1. Mark current serving as completed
            const { error: error1 } = await supabaseClient
                .from('queue')
                .update({ status: 'completed', finished_at: new Date().toISOString() })
                .eq('status', 'called');

            if (error1) {
                console.error('Error completing current customer:', error1);
                throw error1;
            }

            // 2. Call the next customer
            const { error: error2 } = await supabaseClient
                .from('queue')
                .update({
                    status: 'called',
                    called_at: new Date().toISOString()
                })
                .eq('id', next.id);

            if (error2) {
                console.error('Error calling next customer:', error2);
                throw error2;
            }

            console.log('Successfully called next customer:', next.ticket_number);
        } catch (err) {
            console.error('Failed to call next customer:', err);
            alert("Failed to call next customer. Check console for details.");
        }
    } else {
        console.log('No customers waiting.');
    }
};

window.completeCustomer = async (id) => {
    if (!supabaseClient) return;
    await supabaseClient.from('queue').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', id);
};

window.cancelTicket = async (id) => {
    if (!supabaseClient) return;
    await supabaseClient.from('queue').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id);
    if (state.activeCustomerId === id) {
        state.activeCustomerId = null;
        localStorage.removeItem('vanilla_active_id');
        setView('join');
    }
};

window.setView = setView;

// --- QR & Other APIs ---
function generateKioskQR() {
    const qrContainer = document.getElementById('kiosk-qr-code');
    if (!qrContainer) return;
    qrContainer.innerHTML = '';

    // Append mode=customer to the QR code URL so scanned devices hide staff buttons
    const url = new URL(window.location.href);
    url.searchParams.set('mode', 'customer');
    url.searchParams.delete('view'); // Start at join view

    new QRCode(qrContainer, {
        text: url.toString(),
        width: 300,
        height: 300,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

function announceTicket(number, name, service) {
    if ('speechSynthesis' in window) {
        // Cancel any ongoing speech to avoid stacking or delays
        window.speechSynthesis.cancel();

        const serviceText = service ? `proceed to ${service} Counter` : 'proceed to the counter';
        const msg = new SpeechSynthesisUtterance(`Ticket number ${number}, ${name}, please ${serviceText}.`);
        msg.rate = 0.9;
        window.speechSynthesis.speak(msg);
    }
}

function requestNotificationPermission() {
    if ('Notification' in window) Notification.requestPermission();
}

function sendNotification(customer) {
    if ('Notification' in window && Notification.permission === 'granted' && state.activeCustomerId === customer.id) {
        new Notification('Your Turn!', { body: `Hello ${customer.name}, Ticket #${customer.ticket_number} is now being served.`, icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209101.png' });
    }
}
