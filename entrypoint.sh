#!/bin/sh

# Set up directories
CONF_DIR="/config"
CONF_FILE="${CONF_DIR}/aria2.conf"
SESSION_FILE="${CONF_DIR}/aria2.session"
DOWNLOAD_DIR="/downloads"

mkdir -p "$CONF_DIR" "$DOWNLOAD_DIR"
mkdir -p /var/run/samba /var/log/samba /var/run/supervisor

# Create empty session file if it doesn't exist
touch "$SESSION_FILE"

# Create default aria2.conf if it doesn't exist
if [ ! -f "$CONF_FILE" ]; then
    cat <<EOF > "$CONF_FILE"
dir=$DOWNLOAD_DIR
input-file=$SESSION_FILE
save-session=$SESSION_FILE
save-session-interval=60
enable-rpc=true
rpc-allow-origin-all=true
rpc-listen-all=true
rpc-listen-port=6800
max-connection-per-server=16
min-split-size=10M
split=16
max-concurrent-downloads=5
allow-overwrite=true
force-save=true
check-integrity=true
EOF
fi

# Apply RPC Secret dynamically
if [ -n "$ARIA2_RPC_SECRET" ]; then
    # Remove existing rpc-secret configuration line
    sed -i '/rpc-secret=/d' "$CONF_FILE"
    # Append the new secret
    echo "rpc-secret=$ARIA2_RPC_SECRET" >> "$CONF_FILE"
fi

# Ensure force-save=true is set to preserve completed tasks across restarts
if ! grep -q "^force-save=" "$CONF_FILE"; then
    echo "force-save=true" >> "$CONF_FILE"
else
    sed -i 's/^force-save=.*/force-save=true/' "$CONF_FILE"
fi

# Ensure check-integrity=true is set to verify existing files and allow proper resumes
if ! grep -q "^check-integrity=" "$CONF_FILE"; then
    echo "check-integrity=true" >> "$CONF_FILE"
else
    sed -i 's/^check-integrity=.*/check-integrity=true/' "$CONF_FILE"
fi

# Ensure auto-file-renaming=false is set to overwrite duplicates instead of renaming them
if ! grep -q "^auto-file-renaming=" "$CONF_FILE"; then
    echo "auto-file-renaming=false" >> "$CONF_FILE"
else
    sed -i 's/^auto-file-renaming=.*/auto-file-renaming=false/' "$CONF_FILE"
fi




# Ensure permissions on configuration and downloads folders
chmod -R 777 "$DOWNLOAD_DIR"
chmod 755 "$CONF_DIR"
chmod 644 "$CONF_FILE" "$SESSION_FILE" 2>/dev/null || true

# Generate config.js for AriaZero containing the RPC Secret and SMB credentials
cat <<EOF > /var/www/html/config.js
window.AriaZeroServerConfig = {
  rpcSecret: "${ARIA2_RPC_SECRET}",
  smbUser: "${SMB_USER:-admin}",
  smbPassword: "${SMB_PASSWORD:-123456}"
};
EOF


# Set up Samba configuration
SMB_CONF="/etc/samba/smb.conf"

cat <<EOF > "$SMB_CONF"
[global]
   workgroup = WORKGROUP
   server string = Aria2 Samba Server
   server role = standalone server
   map to guest = bad user
   dns proxy = no
   security = user
   create mask = 0777
   directory mask = 0777
   force create mode = 0777
   force directory mode = 0777
   force user = root
   force group = root
   load printers = no
   printing = bsd
   printcap name = /dev/null
   disable spoolss = yes
   logging = file
   log file = /var/log/samba/log.%m
   max log size = 1000

[downloads]
   comment = Aria2 Downloads Share
   path = $DOWNLOAD_DIR
   browsable = yes
   writable = yes
   read only = no
EOF

SMB_USER="${SMB_USER:-admin}"
SMB_PASSWORD="${SMB_PASSWORD:-123456}"

echo "Configuring Samba with authenticated access (User: ${SMB_USER})..."
# Create system user if it doesn't exist (Debian useradd)
if ! id "$SMB_USER" >/dev/null 2>&1; then
    useradd -M -s /usr/sbin/nologin "$SMB_USER"
fi
# Set Samba password
(echo "$SMB_PASSWORD"; echo "$SMB_PASSWORD") | smbpasswd -a -s "$SMB_USER"

cat <<EOF >> "$SMB_CONF"
   guest ok = no
   valid users = $SMB_USER
EOF

# === Jackett Setup ===
JACKETT_DATA_DIR="/config/jackett"
JACKETT_INDEXER_DIR="$JACKETT_DATA_DIR/Indexers"
JACKETT_SERVER_CONFIG="$JACKETT_DATA_DIR/ServerConfig.json"

mkdir -p "$JACKETT_DATA_DIR" "$JACKETT_INDEXER_DIR"

# Create default ServerConfig.json if it doesn't exist
if [ ! -f "$JACKETT_SERVER_CONFIG" ]; then
    cat <<'JACKETT_CFG' > "$JACKETT_SERVER_CONFIG"
{
  "BasePathOverride": "/jackett",
  "AllowExternal": true,
  "UpdateDisabled": true
}
JACKETT_CFG
    echo "Created default Jackett ServerConfig.json"
fi

# Ensure BasePathOverride is always set to /jackett and AllowExternal is true
python3 -c "
import json, os
p = '$JACKETT_SERVER_CONFIG'
if os.path.exists(p):
    try:
        with open(p, 'r') as f:
            d = json.load(f)
        updated = False
        if d.get('BasePathOverride') != '/jackett':
            d['BasePathOverride'] = '/jackett'
            updated = True
        if d.get('AllowExternal') != True:
            d['AllowExternal'] = True
            updated = True
        if updated:
            with open(p, 'w') as f:
                json.dump(d, f, indent=2)
            print('Successfully updated Jackett ServerConfig.json with proxy overrides')
    except Exception as e:
        print('Error updating ServerConfig.json:', e)
"

# Create the background setup indexers script
cat <<'SETUP_SCRIPT' > /usr/local/bin/setup_jackett_indexers.py
import urllib.request
import urllib.error
import http.cookiejar
import json
import time
import os

print("Jackett indexer setup script started in background...")
time.sleep(3) # Give supervisord a head start

cookie_jar = http.cookiejar.CookieJar()
cookie_handler = urllib.request.HTTPCookieProcessor(cookie_jar)
opener = urllib.request.build_opener(cookie_handler)

max_attempts = 15
for attempt in range(max_attempts):
    try:
        resp = opener.open("http://127.0.0.1/jackett/UI/Dashboard", timeout=3)
        if resp.getcode() == 200:
            print("Jackett is up and running! Proceeding to setup indexers...")
            break
    except Exception:
        pass
    print(f"Waiting for Jackett to start (attempt {attempt+1}/{max_attempts})...")
    time.sleep(2)
else:
    print("Jackett failed to start within the timeout period. Exiting setup script.")
    exit(1)

# Remove 1337x.json configuration file to prevent search timeouts
config_1337x = "/config/jackett/Indexers/1337x.json"
if os.path.exists(config_1337x):
    try:
        os.remove(config_1337x)
        print("Successfully removed 1337x.json configuration file.")
    except Exception as e:
        print("Failed to remove 1337x.json:", e)

indexers = ["thepiratebay", "yts", "eztv", "limetorrents"]
for idx in indexers:
    config_file = f"/config/jackett/Indexers/{idx}.json"

    # Check if already configured (size > 100 bytes)
    if os.path.exists(config_file) and os.path.getsize(config_file) > 100:
        print(f"Indexer {idx} is already configured. Skipping.")
        continue
        
    print(f"Configuring indexer: {idx}...")
    try:
        url_get = f"http://127.0.0.1/jackett/api/v2.0/indexers/{idx}/config"
        req_get = urllib.request.Request(url_get, headers={"Accept": "application/json"})
        with opener.open(req_get, timeout=5) as resp:
            default_config = json.loads(resp.read().decode('utf-8'))
            
        # Customize 1337x to use a working mirror domain (1337x.ws) that is not blocked by Cloudflare
        if idx == "1337x":
            for field in default_config:
                if field.get("id") == "sitelink":
                    field["value"] = "https://1337x.ws/"
                    print("Customized 1337x Site Link to https://1337x.ws/")
            
        url_post = f"http://127.0.0.1/jackett/api/v2.0/indexers/{idx}/config"
        req_post = urllib.request.Request(
            url_post,
            data=json.dumps(default_config).encode('utf-8'),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST"
        )
        with opener.open(req_post, timeout=5) as resp:
            if resp.getcode() in (200, 204):
                print(f"Successfully configured indexer {idx}!")
            else:
                print(f"Failed to configure indexer {idx}. Status code: {resp.getcode()}")
    except Exception as e:
        print(f"Error configuring indexer {idx}:", e)
SETUP_SCRIPT

# Run indexer setup script in background
python3 -u /usr/local/bin/setup_jackett_indexers.py &

# Execute supervisor
echo "Starting Supervisor process manager..."
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
