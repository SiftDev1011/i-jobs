#!/usr/bin/env bash
# One-time setup for a fresh Oracle Always Free Ampere server (Ubuntu 24.04, ARM).
# Run as a sudo user:  curl -fsSL <raw url> | bash   or   sudo bash setup-server.sh
# Safe to run again.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then exec sudo -E bash "$0" "$@"; fi
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-ubuntu}}"
APP_DIR="${APP_DIR:-/opt/ijobs}"

echo "==> System updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg unattended-upgrades fail2ban ufw jq rclone
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Firewall: SSH only. The API is reached through Cloudflare Tunnel, never a public port."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
# Oracle images also ship iptables rules; ufw sits on top of them. Also check the
# VCN security list in the Oracle console allows only port 22 inbound.

echo "==> SSH: keys only"
sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i -E 's/^#?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

cat >/etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban

echo "==> Swap (4 GB) so a memory spike slows things down instead of killing Postgres"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
echo 'vm.swappiness=10' > /etc/sysctl.d/99-ijobs.conf
# Redis asks for this.
echo 'vm.overcommit_memory=1' >> /etc/sysctl.d/99-ijobs.conf
sysctl --system >/dev/null

echo "==> Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker "$DEPLOY_USER"
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
systemctl restart docker

echo "==> App folder"
mkdir -p "$APP_DIR"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
touch /var/log/ijobs-backup.log && chown "$DEPLOY_USER" /var/log/ijobs-backup.log
cat >/etc/logrotate.d/ijobs <<'EOF'
/var/log/ijobs-backup.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
EOF

echo
echo "Done. Next (as $DEPLOY_USER, after logging out and back in for the docker group):"
echo "  1. Copy the infra/ folder to $APP_DIR/infra"
echo "  2. cp $APP_DIR/infra/.env.example $APP_DIR/infra/.env and fill it in"
echo "  3. rclone config   (remote 'r2', then a 'crypt' remote 'r2-crypt' over it)"
echo "  4. docker compose -f $APP_DIR/infra/docker-compose.yml --env-file $APP_DIR/infra/.env up -d"
echo "  5. crontab -e  →  17 2 * * * $APP_DIR/infra/scripts/backup.sh >> /var/log/ijobs-backup.log 2>&1"
