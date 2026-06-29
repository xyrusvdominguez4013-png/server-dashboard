"""
Master Dashboard - Server Monitoring Application
Serves the UI and provides agent configuration to the frontend.
"""

import os
import json
from flask import Flask, render_template, jsonify, request
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


@app.route('/api/agents', methods=['POST'])
def save_agents():
    """Save agent configurations to the .env file."""
    import re
    
    try:
        data = request.get_json()
        
        if not data or 'agents' not in data:
            return jsonify({'error': 'Invalid data format'}), 400
        
        agents = data['agents']
        
        if not isinstance(agents, list):
            return jsonify({'error': 'Agents must be a list'}), 400
        
        # Validate each agent
        for agent in agents:
            if not isinstance(agent, dict):
                return jsonify({'error': 'Each agent must be an object'}), 400
            if 'name' not in agent or 'ip' not in agent or 'token' not in agent:
                return jsonify({'error': 'Each agent must have name, ip, and token'}), 400
        
        # Read current .env file
        env_path = os.path.join(os.path.dirname(__file__), '.env')
        
        # If .env doesn't exist, create it from .env.example
        if not os.path.exists(env_path):
            example_path = os.path.join(os.path.dirname(__file__), '.env.example')
            if os.path.exists(example_path):
                with open(example_path, 'r') as f:
                    content = f.read()
                with open(env_path, 'w') as f:
                    f.write(content)
            else:
                # Create minimal .env
                with open(env_path, 'w') as f:
                    f.write('# Server Monitor Dashboard - Environment Configuration\n')
                    f.write('PORT=5001\n')
        
        # Read existing .env content
        with open(env_path, 'r') as f:
            lines = f.readlines()
        
        # Find and replace AGENTS_CONFIG line
        new_agents_json = json.dumps(agents)
        found = False
        new_lines = []
        
        for line in lines:
            if line.strip().startswith('AGENTS_CONFIG='):
                # Escape single quotes in JSON for shell compatibility
                escaped_json = new_agents_json.replace("'", "'\"'\"'")
                new_lines.append(f"AGENTS_CONFIG='{escaped_json}'\n")
                found = True
            else:
                new_lines.append(line)
        
        # If AGENTS_CONFIG wasn't found, append it
        if not found:
            new_lines.append(f"\nAGENTS_CONFIG='{new_agents_json}'\n")
        
        # Write back to .env file
        with open(env_path, 'w') as f:
            f.writelines(new_lines)
        
        # Reload environment variables
        load_dotenv(override=True)
        
        return jsonify({'success': True, 'message': f'Saved {len(agents)} server(s)'})
    
    except Exception as e:
        app.logger.error(f"Failed to save agents config: {e}")
        return jsonify({'error': str(e)}), 500


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
