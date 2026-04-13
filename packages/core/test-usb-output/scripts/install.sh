#!/bin/bash
# Hestia Installation Script
# Generated: 2026-04-12T16:46:34.585Z

set -e

echo "HESTIA USB INSTALLATION"
echo "========================"

# Check root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root: sudo $0"
  exit 1
fi

# Detect platform
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"

# Installation steps
echo "1. Installing dependencies..."
if [ -f /etc/debian_version ]; then
  apt-get update
  apt-get install -y curl wget git docker.io docker-compose nodejs npm postgresql redis-server
elif [ -f /etc/redhat-release ]; then
  yum install -y curl wget git docker docker-compose nodejs npm postgresql redis
elif [ -f /etc/arch-release ]; then
  pacman -Syu --noconfirm curl wget git docker docker-compose nodejs npm postgresql redis
fi

echo "2. Setting up Hestia..."
mkdir -p /opt/hestia
cp -r "$(dirname "$0")/../*" /opt/hestia/

echo "3. Creating system user..."
useradd -r -s /bin/false hestia || true

echo "4. Installing systemd services..."
cp "$(dirname "$0")/../systemd/*" /etc/systemd/system/ 2>/dev/null || echo "No systemd services found - creating basic services"

# Create basic systemd services if they don't exist
cat > /etc/systemd/system/hestia.service << EOF
[Unit]
Description=Hestia Infrastructure Manager
After=network.target docker.service postgresql.service redis.service

[Service]
Type=simple
User=hestia
WorkingDirectory=/opt/hestia
ExecStart=/opt/hestia/bin/hestia ignite
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo "5. Starting services..."
systemctl daemon-reload || true
systemctl enable docker || true
systemctl start docker || true

echo "✅ Hestia installation complete!"
echo ""
echo "Next steps:"
echo "1. cd /opt/hestia"
echo "2. ./bin/hestia init --name 'My Hearth'"
echo "3. ./bin/hestia ignite"
echo "4. Visit http://localhost:4000"
