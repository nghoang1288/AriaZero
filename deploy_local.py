import paramiko
import os
import sys

# Reconfigure stdout to use UTF-8 to prevent encoding errors
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

hostname = "192.168.50.226"
username = "illusion88"
password = "armageddon"
remote_dir = "/home/illusion88/ariazero_temp"
local_dir = "e:/Code linh tinh/ariazero"

def run_ssh_cmd(ssh, cmd):
    print(f"Executing: {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdin.write(password + '\n')
    stdin.flush()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

try:
    print(f"Connecting to {hostname}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname, username=username, password=password, timeout=10)
    print("Connected successfully.")

    # 1. Recreate remote directory
    print("Recreating remote directory...")
    run_ssh_cmd(ssh, f"rm -rf {remote_dir} && mkdir -p {remote_dir}")

    # 2. Open SFTP client
    sftp = ssh.open_sftp()

    # 3. Walk local folder and upload files
    print("Uploading source files (excluding large folders)...")
    for root, dirs, files in os.walk(local_dir):
        # Normalize paths for check
        rel_path = os.path.relpath(root, local_dir).replace("\\", "/")
        
        # Skip git, node_modules, cache, dist, etc.
        skip = False
        for part in rel_path.split("/"):
            if part in ['.git', 'node_modules', 'dist', '__pycache__', '.agents', '.github']:
                skip = True
                break
        if skip:
            continue

        # Recreate directory on remote
        if rel_path != ".":
            rem_path = f"{remote_dir}/{rel_path}"
            # Create remote dir if not exists
            try:
                sftp.mkdir(rem_path)
            except IOError:
                pass
        else:
            rem_path = remote_dir

        for file in files:
            # Skip history database and temporary/deployment scripts to prevent locks
            if file in ['ariazero_history.db', 'check_server.py', 'deploy_local.py', '.gitignore']:
                continue
            
            local_file = os.path.join(root, file).replace("\\", "/")
            remote_file = f"{rem_path}/{file}" if rel_path != "." else f"{remote_dir}/{file}"
            
            print(f"Uploading: {rel_path}/{file}" if rel_path != "." else f"Uploading: {file}")
            sftp.put(local_file, remote_file)

    sftp.close()
    print("File upload completed successfully.")

    # 4. Build Docker image on the remote host
    print("Building Docker image on remote server (this may take a minute)...")
    out, err = run_ssh_cmd(ssh, f"sudo -S docker -H tcp://127.0.0.1:2375 build -t illusion1208/ariazero:latest {remote_dir}")
    print(out)
    if "Error" in err or "failed" in err.lower():
        print(f"Build Error Stderr: {err}")

    # 5. Stop and remove existing container
    print("Checking for existing container...")
    out, err = run_ssh_cmd(ssh, "sudo -S docker -H tcp://127.0.0.1:2375 ps -a --filter name=ariazero --format '{{.ID}}'")
    c_ids = [c.strip() for c in out.strip().split('\n') if c.strip() and not c.startswith("[sudo]")]
    
    if c_ids:
        c_id = c_ids[0]
        print(f"Stopping existing container {c_id}...")
        run_ssh_cmd(ssh, f"sudo -S docker -H tcp://127.0.0.1:2375 stop {c_id}")
        print(f"Removing existing container {c_id}...")
        run_ssh_cmd(ssh, f"sudo -S docker -H tcp://127.0.0.1:2375 rm {c_id}")

    # 6. Start the new container
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
        "-e ARIA2_RPC_SECRET=armageddon "
        "--restart unless-stopped "
        "illusion1208/ariazero:latest"
    )
    print("Starting new container...")
    out, err = run_ssh_cmd(ssh, run_cmd)
    print(f"Container started: {out.strip()}")
    
    # 7. Check if running
    out, err = run_ssh_cmd(ssh, "sudo -S docker -H tcp://127.0.0.1:2375 ps --filter name=ariazero")
    print("Status of running container:")
    print(out)

    ssh.close()
    print("Deployment completed successfully!")

except Exception as e:
    print(f"Deployment failed: {e}")
    sys.exit(1)
