#!/bin/bash

###############################################################################
# Server Monitor Dashboard - Installation Script
# This script sets up the environment, installs dependencies, and validates
# the system readiness for the Master Dashboard.
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Helper functions
print_header() {
    echo -e "\n${CYAN}${BOLD}========================================${NC}"
    echo -e "${CYAN}${BOLD}$1${NC}"
    echo -e "${CYAN}${BOLD}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check if running in correct directory
check_directory() {
    if [ ! -f "master_app.py" ]; then
        print_error "Error: master_app.py not found. Please run this script from the project root directory."
        exit 1
    fi
    print_success "Directory validation passed"
}

# Check Python version
check_python() {
    print_header "Checking Python Installation"
    
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed. Please install Python 3.8 or higher."
        exit 1
    fi
    
    PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
    print_success "Python $PYTHON_VERSION detected"
    
    # Check minimum version (3.8)
    REQUIRED_VERSION="3.8"
    if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$PYTHON_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
        print_error "Python version must be $REQUIRED_VERSION or higher. Current: $PYTHON_VERSION"
        exit 1
    fi
}

# Check and create virtual environment
setup_venv() {
    print_header "Setting Up Virtual Environment"
    
    if [ -d "venv" ]; then
        print_warning "Virtual environment already exists. Skipping creation."
    else
        print_info "Creating virtual environment..."
        python3 -m venv venv
        print_success "Virtual environment created successfully"
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    print_success "Virtual environment activated"
}

# Install Python dependencies
install_dependencies() {
    print_header "Installing Python Dependencies"
    
    if [ ! -f "requirements.txt" ]; then
        print_error "requirements.txt not found. Cannot install dependencies."
        exit 1
    fi
    
    print_info "Upgrading pip..."
    pip install --upgrade pip > /dev/null 2>&1
    
    print_info "Installing requirements..."
    pip install -r requirements.txt
    
    # Verify critical packages
    python3 -c "import flask" 2>/dev/null || { print_error "Flask installation failed"; exit 1; }
    python3 -c "import dotenv" 2>/dev/null || { print_error "python-dotenv installation failed"; exit 1; }
    
    print_success "All Python dependencies installed successfully"
}

# Setup .env file
setup_env_file() {
    print_header "Configuring Environment File"
    
    if [ -f ".env" ]; then
        print_warning ".env file already exists. Skipping creation."
        print_info "To reconfigure, delete .env and run this script again."
    else
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_success ".env file created from .env.example"
            print_info ""
            print_info "IMPORTANT: Edit .env file and add your agent configurations:"
            print_info "  AGENTS_CONFIG='[{\"name\": \"Server 1\", \"ip\": \"192.168.1.10\", \"token\": \"your-token\"}]'"
            print_info "  PORT=5000 (optional, defaults to 5000)"
            print_info ""
        else
            print_warning ".env.example not found. Creating default .env..."
            cat > .env << EOF
# Server Monitor Dashboard Configuration
# List of agents to monitor. Format as a JSON array string.
AGENTS_CONFIG='[]'

# Optional: Custom port (defaults to 5000)
# PORT=5000
EOF
            print_success "Default .env file created"
        fi
    fi
}

# Check system resources
check_system_resources() {
    print_header "Checking System Resources"
    
    # Check available disk space (need at least 100MB)
    AVAILABLE_SPACE=$(df -k . | tail -1 | awk '{print $4}')
    MIN_SPACE=102400  # 100MB in KB
    
    if [ "$AVAILABLE_SPACE" -lt "$MIN_SPACE" ]; then
        print_warning "Low disk space: $(($AVAILABLE_SPACE / 1024))MB available (recommended: 100MB+)"
    else
        print_success "Disk space OK: $(($AVAILABLE_SPACE / 1024))MB available"
    fi
    
    # Check available memory (rough estimate)
    if command -v free &> /dev/null; then
        AVAILABLE_MEM=$(free -m | awk 'NR==2{print $7}')
        if [ "$AVAILABLE_MEM" -lt 256 ]; then
            print_warning "Low memory: ${AVAILABLE_MEM}MB available (recommended: 256MB+)"
        else
            print_success "Memory OK: ${AVAILABLE_MEM}MB available"
        fi
    fi
}

# Validate configuration
validate_config() {
    print_header "Validating Configuration"
    
    source venv/bin/activate
    
    # Test if the app can load without errors
    print_info "Testing application import..."
    if python3 -c "import master_app" 2>/dev/null; then
        print_success "Application imports successfully"
    else
        print_error "Failed to import application. Check master_app.py for syntax errors."
        exit 1
    fi
    
    # Check if AGENTS_CONFIG is set (warn if empty)
    AGENTS_COUNT=$(python3 -c "
import os
from dotenv import load_dotenv
import json
load_dotenv()
config = os.getenv('AGENTS_CONFIG', '[]')
try:
    agents = json.loads(config)
    print(len(agents))
except:
    print('0')
" 2>/dev/null)
    
    if [ "$AGENTS_COUNT" -eq 0 ]; then
        print_warning "No agents configured in .env file"
        print_info "Edit .env and add agents to start monitoring:"
        print_info "  AGENTS_CONFIG='[{\"name\": \"Server 1\", \"ip\": \"192.168.1.10\", \"token\": \"token123\"}]'"
    else
        print_success "$AGENTS_COUNT agent(s) configured"
    fi
}

# Final summary
print_summary() {
    print_header "Installation Complete!"
    
    echo -e "${GREEN}${BOLD}System is ready to run!${NC}\n"
    
    echo -e "${BLUE}Next steps:${NC}"
    echo -e "  1. Edit ${BOLD}.env${NC} to add your agent configurations"
    echo -e "  2. Run the dashboard: ${BOLD}python3 master_app.py${NC}"
    echo -e "  3. Open browser: ${BOLD}http://localhost:5000${NC}\n"
    
    echo -e "${BLUE}Optional:${NC}"
    echo -e "  - Change port by adding ${BOLD}PORT=5001${NC} to .env"
    echo -e "  - Activate venv manually: ${BOLD}source venv/bin/activate${NC}\n"
    
    print_success "Happy monitoring! 🚀\n"
}

# Main execution
main() {
    print_header "🖥️  Server Monitor Dashboard Installer"
    
    check_directory
    check_python
    setup_venv
    install_dependencies
    setup_env_file
    check_system_resources
    validate_config
    print_summary
}

# Run main function
main
