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
    const card = document.createElement('article');
    card.className = 'server-card connecting';
    card.id = cardId;
    card.dataset.ip = agent.ip;
    
    card.innerHTML = `
        <header class="card-header">
            <div class="server-info">
                <h3 class="server-name">${escapeHtml(agent.name)}</h3>
                <span class="server-ip">${agent.ip}</span>
            </div>
            <div class="card-status connecting" id="${cardId}-status">
                <span class="status-indicator"></span>
                <span>Connecting</span>
            </div>
        </header>
        <div class="metrics-container">
            <div class="metrics-grid">
                <div class="metric-box">
                    <div class="metric-label">CPU</div>
                    <div class="metric-value normal" id="${cardId}-cpu">--<span class="metric-unit">%</span></div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">RAM</div>
                    <div class="metric-value normal" id="${cardId}-ram">--<span class="metric-unit">%</span></div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">DISK</div>
                    <div class="metric-value normal" id="${cardId}-disk">--<span class="metric-unit">%</span></div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">NETWORK</div>
                    <div class="metric-value" id="${cardId}-network">--<span class="metric-unit">KB/s</span></div>
                </div>
            </div>
            <div class="chart-container">
                <div class="chart-title">
                    <span>CPU History</span>
                    <span id="${cardId}-chart-time">Live</span>
                </div>
                <div class="chart-wrapper">
                    <canvas id="${cardId}-chart"></canvas>
                </div>
            </div>
        </div>
    `;
    
    // Initialize Chart.js for this server after DOM insertion
    setTimeout(() => initChart(cardId), 0);
    
    return card;
}

/**
 * Initialize Chart.js instance for a server card
 */
function initChart(cardId) {
    const canvas = document.getElementById(`${cardId}-chart`);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Create chart with dark theme styling
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'CPU %',
                data: [],
                borderColor: '#58a6ff',
                backgroundColor: 'rgba(88, 166, 255, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            scales: {
                x: {
                    display: false,
                    grid: {
                        color: 'rgba(48, 54, 61, 0.5)'
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: {
                        color: 'rgba(48, 54, 61, 0.5)'
                    },
                    ticks: {
                        color: '#8b949e',
                        font: {
                            family: "'JetBrains Mono', monospace",
                            size: 10
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: '#161b22',
                    titleColor: '#f0f6fc',
                    bodyColor: '#8b949e',
                    borderColor: '#30363d',
                    borderWidth: 1,
                    titleFont: {
                        family: "'JetBrains Mono', monospace"
                    },
                    bodyFont: {
                        family: "'JetBrains Mono', monospace"
                    }
                }
            }
        }
    });
    
    // Store chart reference in server state
    const ip = cardId.replace('server-', '').replace(/-/g, '.');
    const state = serverStates.get(ip);
    if (state) {
        state.chart = chart;
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
    
    try {
        const response = await fetch(`http://${ip}:5001/stream`, {
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
    
    if (!state) return;
    
    // Update metric displays
    updateMetricValue(cardId, 'cpu', metrics.cpu, '%');
    updateMetricValue(cardId, 'ram', metrics.ram, '%');
    updateMetricValue(cardId, 'disk', metrics.disk, '%');
    updateMetricValue(cardId, 'network', formatNetwork(metrics.network), 'KB/s');
    
    // Update chart
    if (state.chart) {
        const now = new Date();
        const timeLabel = now.toLocaleTimeString();
        
        // Add new data point
        state.chart.data.labels.push(timeLabel);
        state.chart.data.datasets[0].data.push(metrics.cpu);
        
        // Trim old data points if exceeding max
        if (state.chart.data.labels.length > MAX_HISTORY_POINTS) {
            state.chart.data.labels.shift();
            state.chart.data.datasets[0].data.shift();
        }
        
        // Update chart
        state.chart.update('none'); // 'none' mode for performance
        
        // Update time display
        const timeElement = document.getElementById(`${cardId}-chart-time`);
        if (timeElement) {
            timeElement.textContent = timeLabel;
        }
    }
}

/**
 * Update a single metric value with appropriate color coding
 */
function updateMetricValue(cardId, metricType, value, unit) {
    const element = document.getElementById(`${cardId}-${metricType}`);
    if (!element) return;
    
    // Remove existing color classes
    element.classList.remove('normal', 'warning', 'critical');
    
    // Determine color class based on value (for percentage metrics)
    if (unit === '%' && typeof value === 'number') {
        if (value >= 90) {
            element.classList.add('critical');
        } else if (value >= 70) {
            element.classList.add('warning');
        } else {
            element.classList.add('normal');
        }
    }
    
    // Update the displayed value
    const numericValue = typeof value === 'number' ? value.toFixed(1) : value;
    element.innerHTML = `${numericValue}<span class="metric-unit">${unit}</span>`;
}

/**
 * Format network speed in KB/s
 */
function formatNetwork(bytesPerSecond) {
    if (typeof bytesPerSecond !== 'number') return '--';
    return (bytesPerSecond / 1024).toFixed(2);
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
        // Destroy charts
        if (state.chart) {
            state.chart.destroy();
        }
    });
    serverStates.clear();
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);
