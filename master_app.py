"""
Master Dashboard - Server Monitoring Application
Serves the UI and provides agent configuration to the frontend.
"""

import os
import json
from flask import Flask, render_template, jsonify
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)


def load_agents_config():
    """
    Parse the AGENTS_CONFIG environment variable which contains a JSON array
    of agent configurations.
    """
    config_str = os.getenv('AGENTS_CONFIG', '[]')
    try:
        agents = json.loads(config_str)
        if not isinstance(agents, list):
            app.logger.error("AGENTS_CONFIG must be a JSON array")
            return []
        return agents
    except json.JSONDecodeError as e:
        app.logger.error(f"Failed to parse AGENTS_CONFIG: {e}")
        return []


@app.route('/')
def index():
    """Serve the main dashboard HTML page."""
    return render_template('index.html')


@app.route('/api/agents')
def get_agents():
    """Return the list of configured agents as JSON for the frontend."""
    agents = load_agents_config()
    return jsonify(agents)


if __name__ == '__main__':
    # Validate configuration on startup
    agents = load_agents_config()
    if not agents:
        print("WARNING: No agents configured. Please set AGENTS_CONFIG in your .env file.")
    else:
        print(f"Loaded {len(agents)} agent(s) from configuration:")
        for agent in agents:
            name = agent.get('name', 'Unknown')
            ip = agent.get('ip', 'Unknown')
            print(f"  - {name} ({ip})")
    
    # Get port from environment variable, default to 5000
    port = int(os.getenv('PORT', 5000))
    
    # Run the Flask development server
    app.run(host='0.0.0.0', port=port, debug=True)
