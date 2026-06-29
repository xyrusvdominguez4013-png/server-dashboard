/**
 * Server Monitor Dashboard - Frontend Logic
 * Handles SSE connections with authentication, data visualization, and UI updates.
 */

// Configuration
const RECONNECT_DELAY = 5000; // 5 seconds
const MAX_HISTORY_POINTS = 60; // Keep last 60 data points in chart

// State management
const serverStates = new Map(); // Store state for each server
let activeConnections = 0;
let totalServers = 0;
let currentAgents = []; // Store current agent configurations

/**
 * Initialize the dashboard on page load
 */
async function init() {
    try {
        const agents = await fetchAgents();
        
        if (!agents || agents.length === 0) {
            showEmptyState();
            updateGlobalStatus('disconnected', 'No servers configured');
            return;
        }
        
        totalServers = agents.length;
        renderServerCards(agents);
        establishConnections(agents);
        updateGlobalStatus('connecting', 'Connecting to servers...');
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        updateGlobalStatus('disconnected', 'Initialization failed');
    }
}

/**
 * Fetch agent configurations from the backend API
 */
async function fetchAgents() {
    const response = await fetch('/api/agents');
    if (!response.ok) {
        throw new Error('Failed to fetch agent configuration');
    }
    return response.json();
}

/**
 * Render server cards dynamically based on agent list
 */
function renderServerCards(agents) {
    const grid = document.getElementById('servers-grid');
    grid.innerHTML = '';
    
    agents.forEach(agent => {
        const cardId = `server-${agent.ip.replace(/\./g, '-')}`;
        const card = createServerCard(agent, cardId);
        grid.appendChild(card);
        
        // Initialize state for this server
        serverStates.set(agent.ip, {
            status: 'connecting',
            cpuHistory: [],
            labels: [],
            abortController: null,
            reconnectTimeout: null
        });
    });
}

/**
 * Create a server card DOM element
 */
function createServerCard(agent, cardId) {
    const card = document.createElement('div');
    card.className = 'server-card connecting';
    card.id = cardId;
    card.dataset.ip = agent.ip;
    
    card.innerHTML = `
    <header class="card-header">
        <div class="server-info">
            <h3 class="server-name">${escapeHtml(agent.name)}</h3>
            <span class="server-ip">${agent.ip}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
            <div class="card-status connecting" id="${cardId}-status">
                <span class="status-indicator"></span>
                <span id="${cardId}-status-text">Connecting</span>
            </div>
            <button class="remove-server-btn" title="Remove Server" onclick="removeServer(configuredAgents.findIndex(a => a.ip === '${agent.ip}'))">✕</button>
        </div>
    </header>
    <div class="card-body">
        <div class="specs-panel">
            <div class="panel-title">System Specifications</div>
            <div id="${cardId}-specs-content" class="inline-specs">
                <div class="loading-text">Fetching specs...</div>
            </div>
        </div>
        <div class="metrics-panel">
            <div class="panel-title">Real-time Telemetry</div>
            <div class="donuts-row">
                <div class="donut-container">
                    <canvas id="${cardId}-cpu-donut"></canvas>
                    <div class="donut-label">CPU</div>
                </div>
                <div class="donut-container">
                    <canvas id="${cardId}-ram-donut"></canvas>
                    <div class="donut-label">RAM</div>
                </div>
                <div class="donut-container">
                    <canvas id="${cardId}-disk-donut"></canvas>
                    <div class="donut-label">DISK</div>
                </div>
            </div>
            <div class="bar-chart-container" style="display: flex; flex-direction: column;">
                <div class="panel-title" style="margin-bottom: 4px; border: none; text-align: center; font-size: 0.65rem;">Network Traffic</div>
                <div style="flex: 1; position: relative;">
                    <canvas id="${cardId}-net-bar"></canvas>
                </div>
            </div>
        </div>
    </div>
    `;
    
    setTimeout(() => {
        initCharts(cardId);
        fetchSpecsInline(agent.ip, agent.token, cardId);
    }, 0);
    
    return card;
}

function initCharts(cardId) {
    const ip = cardId.replace('server-', '').replace(/-/g, '.');
    const state = serverStates.get(ip);
    if (!state) return;

    state.charts = {};

    const createDonut = (ctxId, color) => {
        const canvas = document.getElementById(ctxId);
        if (!canvas) return null;
        return new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Used', 'Free'],
                datasets: [{
                    data: [0, 100],
                    backgroundColor: [color, 'rgba(255,255,255,0.05)'],
                    borderWidth: 0,
                    cutout: '75%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                events: []
            },
            plugins: [{
                id: 'textCenter',
                beforeDraw: function(chart) {
                    var width = chart.width, height = chart.height, ctx = chart.ctx;
                    ctx.restore();
                    var fontSize = (height / 80).toFixed(2);
                    ctx.font = fontSize + "em 'JetBrains Mono'";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = "#e2e8f0";
                    var text = Math.round(chart.data.datasets[0].data[0]) + "%",
                        textX = Math.round((width - ctx.measureText(text).width) / 2),
                        textY = height / 2;
                    ctx.fillText(text, textX, textY);
                    ctx.save();
                }
            }]
        });
    };

    state.charts.cpu = createDonut(`${cardId}-cpu-donut`, '#00f0ff');
    state.charts.ram = createDonut(`${cardId}-ram-donut`, '#00ff9d');
    state.charts.disk = createDonut(`${cardId}-disk-donut`, '#ffb700');

    const netCanvas = document.getElementById(`${cardId}-net-bar`);
    if (netCanvas) {
        state.charts.net = new Chart(netCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Sent (KB/s)', data: [], borderColor: '#00f0ff', backgroundColor: 'rgba(0, 240, 255, 0.1)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
                    { label: 'Recv (KB/s)', data: [], borderColor: '#ff2a5f', backgroundColor: 'rgba(255, 42, 95, 0.1)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                scales: {
                    x: { display: false },
                    y: { 
                        beginAtZero: true, 
                        grid: { color: 'rgba(59, 130, 246, 0.1)' },
                        ticks: { color: '#64748b', font: { family: "'JetBrains Mono'" } }
                    }
                },
                plugins: {
                    legend: { 
                        display: true, 
                        labels: { color: '#e2e8f0', font: { family: "'JetBrains Mono'", size: 10 }, boxWidth: 12 }
                    },
                    tooltip: { mode: 'index', intersect: false }
                }
            }
        });
    }
}

/**
 * Establish SSE connections to all agents using Fetch API with ReadableStream
 * This workaround is necessary because EventSource doesn't support custom headers
 */
function establishConnections(agents) {
    agents.forEach(agent => {
        connectToAgent(agent);
    });
}

/**
 * Connect to a single agent using authenticated Fetch + ReadableStream
 */
async function connectToAgent(agent) {
    const { ip, token } = agent;
    const cardId = `server-${ip.replace(/\./g, '-')}`;
    let state = serverStates.get(ip);
    
    if (!state) return;
    
    // Clear any pending reconnection
    if (state.reconnectTimeout) {
        clearTimeout(state.reconnectTimeout);
        state.reconnectTimeout = null;
    }
    
    // Create abort controller for this connection
    const abortController = new AbortController();
    state.abortController = abortController;
    
    updateCardStatus(cardId, 'connecting');
    
    const baseUrl = ip.includes(':') ? `http://${ip}` : `http://${ip}:5000`;
    try {
        const response = await fetch(`${baseUrl}/stream`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            },
            signal: abortController.signal
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        updateCardStatus(cardId, 'connected');
        updateServerConnection(ip, 'connected');
        
        // Process the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                console.log(`Stream closed for ${ip}`);
                break;
            }
            
            // Decode and buffer the chunk
            buffer += decoder.decode(value, { stream: true });
            
            // Process complete SSE messages (separated by double newline)
            const messages = buffer.split('\n\n');
            buffer = messages.pop() || ''; // Keep incomplete message in buffer
            
            for (const message of messages) {
                const lines = message.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6); // Remove 'data: ' prefix
                        try {
                            const metrics = JSON.parse(data);
                            updateServerMetrics(ip, metrics);
                        } catch (parseError) {
                            console.warn(`Failed to parse SSE data from ${ip}:`, parseError);
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log(`Connection aborted for ${ip}`);
            return;
        }
        
        console.error(`Connection error for ${ip}:`, error);
        handleDisconnection(agent);
    }
}

/**
 * Handle disconnection and schedule reconnection
 */
function handleDisconnection(agent) {
    const { ip } = agent;
    const cardId = `server-${ip.replace(/\./g, '-')}`;
    let state = serverStates.get(ip);
    
    if (!state) return;
    
    updateCardStatus(cardId, 'disconnected');
    updateServerConnection(ip, 'disconnected');
    
    // Schedule reconnection
    state.reconnectTimeout = setTimeout(() => {
        console.log(`Attempting to reconnect to ${ip}...`);
        connectToAgent(agent);
    }, RECONNECT_DELAY);
}

/**
 * Update server metrics in the UI
 */
function updateServerMetrics(ip, metrics) {
    const cardId = `server-${ip.replace(/\./g, '-')}`;
    const state = serverStates.get(ip);
    
    if (!state || !state.charts) return;
    
    const updateDonut = (chart, value) => {
        if (chart && typeof value === 'number') {
            chart.data.datasets[0].data = [value, Math.max(0, 100 - value)];
            chart.update('none');
        }
    };
    
    updateDonut(state.charts.cpu, metrics.cpu);
    updateDonut(state.charts.ram, metrics.ram?.percent);
    updateDonut(state.charts.disk, metrics.disk?.percent);
    
    if (state.charts.net) {
        const netChart = state.charts.net;
        const now = new Date();
        const timeLabel = now.toLocaleTimeString();
        
        const sentKbps = ((metrics.network?.sent_mb_s || 0) * 1024).toFixed(2);
        const recvKbps = ((metrics.network?.recv_mb_s || 0) * 1024).toFixed(2);
        
        netChart.data.labels.push(timeLabel);
        netChart.data.datasets[0].data.push(sentKbps);
        netChart.data.datasets[1].data.push(recvKbps);
        
        if (netChart.data.labels.length > 20) {
            netChart.data.labels.shift();
            netChart.data.datasets[0].data.shift();
            netChart.data.datasets[1].data.shift();
        }
        
        netChart.update('none');
    }
}

/**
 * Update card status indicator
 */
function updateCardStatus(cardId, status) {
    const statusElement = document.getElementById(`${cardId}-status`);
    const cardElement = document.getElementById(cardId);
    
    if (!statusElement || !cardElement) return;
    
    // Remove all status classes
    statusElement.classList.remove('connected', 'disconnected', 'connecting');
    cardElement.classList.remove('connected', 'disconnected', 'connecting');
    
    // Add new status class
    statusElement.classList.add(status);
    cardElement.classList.add(status);
    
    // Update text
    const textSpan = statusElement.querySelector('span:last-child');
    if (textSpan) {
        textSpan.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
}

/**
 * Track overall server connection status
 */
function updateServerConnection(ip, status) {
    const state = serverStates.get(ip);
    if (state) {
        state.status = status;
    }
    
    // Count active connections
    activeConnections = 0;
    serverStates.forEach(s => {
        if (s.status === 'connected') activeConnections++;
    });
    
    // Update global status
    updateGlobalStatusFromConnections();
}

/**
 * Update global connection status based on individual connections
 */
function updateGlobalStatusFromConnections() {
    if (activeConnections === 0) {
        updateGlobalStatus('disconnected', 'All servers disconnected');
    } else if (activeConnections === totalServers) {
        updateGlobalStatus('connected', `${activeConnections}/${totalServers} connected`);
    } else {
        updateGlobalStatus('connecting', `${activeConnections}/${totalServers} connected`);
    }
}

/**
 * Update the global status indicator in the header
 */
function updateGlobalStatus(status, text) {
    const statusDot = document.querySelector('#global-status .status-dot');
    const statusText = document.querySelector('#global-status .status-text');
    
    if (!statusDot || !statusText) return;
    
    statusDot.classList.remove('connected', 'disconnected');
    statusDot.classList.add(status);
    statusText.textContent = text;
}

/**
 * Show empty state when no servers are configured
 */
function showEmptyState() {
    const grid = document.getElementById('servers-grid');
    const emptyState = document.getElementById('empty-state');
    
    if (grid) grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Cleanup function called when page unloads
 */
function cleanup() {
    serverStates.forEach(state => {
        // Abort any active connections
        if (state.abortController) {
            state.abortController.abort();
        }
        // Clear any pending timeouts
        if (state.reconnectTimeout) {
            clearTimeout(state.reconnectTimeout);
        }
        if (state.charts) {
            Object.values(state.charts).forEach(chart => {
                if (chart) chart.destroy();
            });
        }
    });
    serverStates.clear();
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);

/**
 * Settings Modal Functions
 */

// Modal elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const modalClose = document.getElementById('modal-close');
const cancelBtn = document.getElementById('cancel-btn');
const configForm = document.getElementById('config-form');
const saveConfigBtn = document.getElementById('save-config-btn');
const configuredServersList = document.getElementById('configured-servers');

// Open modal
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
        loadCurrentAgents();
    });
}

// Close modal functions
function closeModal() {
    if (settingsModal) {
        settingsModal.style.display = 'none';
    }
}

if (modalClose) {
    modalClose.addEventListener('click', closeModal);
}

if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
}

// Close modal when clicking outside
if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeModal();
        }
    });
}

// Load current agents from server
async function loadCurrentAgents() {
    try {
        const response = await fetch('/api/agents');
        if (response.ok) {
            currentAgents = await response.json();
            renderConfiguredServers();
        }
    } catch (error) {
        console.error('Failed to load current agents:', error);
    }
}

// Render the list of configured servers in the modal
function renderConfiguredServers() {
    if (!configuredServersList) return;
    
    configuredServersList.innerHTML = '';
    
    if (currentAgents.length === 0) {
        configuredServersList.innerHTML = '<li class="empty-list">No servers configured yet</li>';
        return;
    }
    
    currentAgents.forEach((agent, index) => {
        const li = document.createElement('li');
        li.className = 'server-item';
        li.innerHTML = `
            <div class="server-info">
                <span class="server-name">${escapeHtml(agent.name)}</span>
                <span class="server-ip">${agent.ip}</span>
            </div>
            <button class="remove-server-btn" data-index="${index}" title="Remove server">🗑️</button>
        `;
        configuredServersList.appendChild(li);
    });
    
    // Add event listeners to remove buttons
    document.querySelectorAll('.remove-server-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.dataset.index);
            removeServer(index);
        });
    });
}

// Add a new server from the form
if (configForm) {
    configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const nameInput = document.getElementById('server-name');
        const ipInput = document.getElementById('server-ip');
        const tokenInput = document.getElementById('server-token');
        
        const newAgent = {
            name: nameInput.value.trim(),
            ip: ipInput.value.trim(),
            token: tokenInput.value.trim()
        };
        
        // Validate IP format (allow optional port)
        const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d{1,5})?$/;
        if (!ipPattern.test(newAgent.ip) && newAgent.ip !== 'localhost') {
            alert('Please enter a valid IP address or hostname (e.g., 192.168.1.10 or 192.168.1.10:5000)');
            return;
        }
        
        currentAgents.push(newAgent);
        renderConfiguredServers();
        
        // Clear form
        nameInput.value = '';
        ipInput.value = '';
        tokenInput.value = '';
        nameInput.focus();
    });
}

// Remove a server from the list
function removeServer(index) {
    if (index >= 0 && index < currentAgents.length) {
        currentAgents.splice(index, 1);
        renderConfiguredServers();
    }
}

// Save configuration to backend
if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/agents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ agents: currentAgents })
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                alert(result.message + '\nNote: You may need to restart the server for changes to take effect.');
                closeModal();
                // Reload the page to apply new configuration
                setTimeout(() => {
                    location.reload();
                }, 1000);
            } else {
                alert('Failed to save configuration: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Failed to save configuration:', error);
            alert('Failed to save configuration: ' + error.message);
        }
    });
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

async function fetchSpecsInline(ip, token, cardId) {
    const specsContent = document.getElementById(`${cardId}-specs-content`);
    if (!specsContent) return;
    
    const baseUrl = ip.includes(':') ? `http://${ip}` : `http://${ip}:5000`;
    try {
        const response = await fetch(`${baseUrl}/api/specs`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        const gpusHtml = data.gpu && data.gpu.length > 0 
            ? data.gpu.map(g => `<span class="spec-value">${escapeHtml(g)}</span>`).join('')
            : '<span class="spec-value">None</span>';
            
        specsContent.innerHTML = `
            <div class="spec-row"><span class="spec-label">Hostname</span><span class="spec-value">${escapeHtml(data.hostname || 'N/A')}</span></div>
            <div class="spec-row"><span class="spec-label">OS</span><span class="spec-value">${escapeHtml(data.os || 'N/A')}</span></div>
            <div class="spec-row" style="margin-top: 10px;"><span class="spec-label">CPU Model</span><span class="spec-value" style="font-size: 0.75rem;">${escapeHtml(data.cpu?.model || 'N/A')}</span></div>
            <div class="spec-row"><span class="spec-label">Cores / Threads</span><span class="spec-value">${data.cpu?.cores || '-'} / ${data.cpu?.threads || '-'}</span></div>
            <div class="spec-row" style="margin-top: 10px;"><span class="spec-label">Total RAM</span><span class="spec-value">${data.ram?.total_gb || '-'} GB</span></div>
            <div class="spec-row"><span class="spec-label">Root Disk</span><span class="spec-value">${data.disk?.total_gb || '-'} GB</span></div>
            <div class="spec-row" style="margin-top: 10px;"><span class="spec-label">Graphics</span>${gpusHtml}</div>
        `;
    } catch (error) {
        console.error('Error fetching specs for ' + ip + ':', error);
        specsContent.innerHTML = `<span style="color: var(--red); font-size: 0.7rem;">Error: ${error.message}</span>`;
    }
}

