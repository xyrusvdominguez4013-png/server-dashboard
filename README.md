# Server Monitor Dashboard

A professional, minimal, and technical-looking distributed server monitoring dashboard. This application serves as the **Master** component in a two-part monitoring system, connecting to remote Agent servers via authenticated SSE (Server-Sent Events).

## Features

- 🖥️ **Real-time Monitoring**: Live CPU, RAM, Disk, and Network metrics from multiple servers
- 🔐 **Authenticated Connections**: Secure Bearer token authentication for each Agent connection
- 📊 **Live Charts**: Chart.js-powered CPU history visualization
- 🎨 **Dark Theme UI**: Professional, clean design inspired by modern developer tools
- 🔄 **Auto-Reconnection**: Automatic reconnection handling with visual status indicators
- 📱 **Responsive Design**: Works on desktop and mobile devices

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Master        │         │   Master        │
│   Dashboard     │◄───────►│   Dashboard     │
│   (This App)    │  HTTP   │   (This App)    │
│   Port: 5000    │         │   Port: 5000    │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │ SSE + Auth                │ SSE + Auth
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│   Agent 1       │         │   Agent 2       │
│   192.168.1.10  │         │   192.168.1.11  │
│   Port: 5001    │         │   Port: 5001    │
└─────────────────┘         └─────────────────┘
```

## Prerequisites

- Python 3.8 or higher
- Access to remote Agent servers running the monitoring agent

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd server-monitor-dashboard
```

### 2. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment

Copy the example environment file and configure your agents:

```bash
cp .env.example .env
```

Edit `.env` and add your agent configurations:

```env
AGENTS_CONFIG='[
  {"name": "Web Server", "ip": "192.168.1.10", "token": "your-token-here"},
  {"name": "DB Server", "ip": "192.168.1.11", "token": "another-token-here"},
  {"name": "App Server", "ip": "192.168.1.12", "token": "third-token-here"}
]'
```

**Important Notes:**
- The `AGENTS_CONFIG` must be a valid JSON array string
- Each agent object requires: `name`, `ip`, and `token`
- The IP should be the address where the Agent is running (port 5001 is assumed)
- Tokens must match the Bearer tokens configured on each Agent server

## Running the Application

### Development Mode

```bash
python master_app.py
```

The dashboard will be available at: **http://localhost:5000**

### Production Mode

For production deployment, use a WSGI server like Gunicorn:

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 master_app:app
```

## Project Structure

```
server-monitor-dashboard/
├── master_app.py          # Flask application backend
├── templates/
│   └── index.html         # Main dashboard HTML
├── static/
│   ├── css/
│   │   └── style.css      # Custom dark theme styles
│   └── js/
│       └── script.js      # Frontend logic & SSE handling
├── requirements.txt       # Python dependencies
├── .env.example          # Environment configuration template
├── .env                  # Your actual configuration (not in git)
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## API Endpoints

### GET /
Serves the main dashboard HTML page.

### GET /api/agents
Returns the list of configured agents as JSON:

```json
[
  {
    "name": "Web Server",
    "ip": "192.168.1.10",
    "token": "your-token-here"
  }
]
```

## Frontend Features

### Metric Color Coding
- **Green** (< 70%): Normal operation
- **Yellow** (70-89%): Warning threshold
- **Red** (≥ 90%): Critical threshold

### Connection Status
- **Connecting**: Establishing SSE connection
- **Connected**: Receiving live data
- **Disconnected**: Connection failed, attempting reconnect

### Auto-Reconnection
If a connection drops, the dashboard automatically attempts to reconnect after 5 seconds.

## Browser Compatibility

Modern browsers with support for:
- Fetch API
- ReadableStream API
- ES6+ JavaScript
- CSS Grid

Tested on: Chrome, Firefox, Safari, Edge

## Troubleshooting

### No servers showing up
- Check that `AGENTS_CONFIG` is properly formatted in your `.env` file
- Ensure the JSON is valid (use a JSON validator)
- Restart the Flask application after changing `.env`

### Connection failures
- Verify the Agent servers are running and accessible
- Check that the IP addresses and ports are correct
- Ensure firewall rules allow connections to port 5001
- Verify the Bearer tokens match on both sides

### CORS issues
- If running the dashboard on a different origin than the Agents, ensure Agents have proper CORS headers
- The Agent should include: `Access-Control-Allow-Origin: *` or your specific origin

## Security Considerations

- Keep your `.env` file secure and never commit it to version control
- Use strong, unique tokens for each Agent
- Consider using HTTPS in production environments
- Restrict network access to the dashboard if monitoring sensitive infrastructure

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
