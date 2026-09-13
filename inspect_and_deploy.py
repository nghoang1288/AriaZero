import paramiko
import sys
import os

hostname = os.environ.get("DEPLOY_HOST", "192.168.50.226")
username = os.environ.get("DEPLOY_USER", "illusion88")
password = os.environ.get("DEPLOY_PASSWORD", "armageddon")
rpc_secret = os.environ.get("ARIA2_RPC_SECRET", "armageddon")

def run_ssh_cmd(ssh, cmd):
    print(f"Executing: {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdin.write(password + '\n')
    stdin.flush()
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    return out, err

try:
    print(f"Connecting to {hostname}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname, username=username, password=password, timeout=10)
    print("Connected successfully.")

    # 1. Pull the latest image
    print("Pulling latest image from Docker Hub...")
    out, err = run_ssh_cmd(ssh, "sudo -S docker -H tcp://127.0.0.1:2375 pull illusion1208/ariazero:latest")
    print(out)

    # 2. Check if container already exists
    out, err = run_ssh_cmd(ssh, "sudo -S docker -H tcp://127.0.0.1:2375 ps -a --filter name=ariazero --format '{{.ID}}'")
    container_ids = [c.strip() for c in out.strip().split('\n') if c.strip() and not c.startswith("[sudo]")]

    if container_ids:
        container_id = container_ids[0]
        print(f"Stopping existing container {container_id}...")
        run_ssh_cmd(ssh, f"sudo -S docker -H tcp://127.0.0.1:2375 stop {container_id}")
        print(f"Removing existing container {container_id}...")
        run_ssh_cmd(ssh, f"sudo -S docker -H tcp://127.0.0.1:2375 rm {container_id}")

    # 3. Formulate the docker run command
    # WebUI on port 16980, RPC on port 16800, SMB on port 445
    # Config stored in /home/illusion88/aria2/config, downloads in /home/illusion88/aria2/downloads
    # Secret key set to 'armageddon'
    run_cmd = (
        "sudo -S docker -H tcp://127.0.0.1:2375 run -d "
        "--name ariazero "
        "-p 16980:80 "
        "-p 16800:6800 "
        "-p 445:445 "
        "-p 6881:6881 "
        "-p 6881:6881/udp "
        "-v /home/illusion88/aria2/config:/config "
        "-v /home/illusion88/aria2/downloads:/downloads "
        f"-e ARIA2_RPC_SECRET={rpc_secret} "
        "--restart unless-stopped "
        "illusion1208/ariazero:latest"
    )

    print("Starting new container...")
    out, err = run_ssh_cmd(ssh, run_cmd)
    if err.strip():
        print(f"Stderr output: {err}")
    print(f"Success! Container started. ID: {out.strip()}")

    # 4. Check docker ps to verify it's running
    out, err = run_ssh_cmd(ssh, "docker ps --filter name=ariazero")
    print("Active container status:")
    print(out)

    ssh.close()

except Exception as e:
    print(f"An error occurred: {e}")
    sys.exit(1)
