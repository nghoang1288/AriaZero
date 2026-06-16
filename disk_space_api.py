from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import shutil
import os
import sqlite3
import threading
import time
import urllib.request
import urllib.error

DB_PATH = '/config/ariazero_history.db'

def init_db():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    try:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS download_history (
                gid TEXT PRIMARY KEY,
                name TEXT,
                total_length INTEGER,
                completed_length INTEGER,
                status TEXT,
                error_code TEXT,
                error_message TEXT,
                completed_time INTEGER,
                files_json TEXT,
                bittorrent_json TEXT
            )
        ''')
        conn.commit()
    finally:
        conn.close()

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def fetch_history():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM download_history ORDER BY completed_time DESC')
        rows = cursor.fetchall()
        result = []
        for r in rows:
            try:
                files = json.loads(r["files_json"]) if r["files_json"] else []
            except Exception:
                files = []
            try:
                bittorrent = json.loads(r["bittorrent_json"]) if r["bittorrent_json"] else None
                if bittorrent == {}:
                    bittorrent = None
            except Exception:
                bittorrent = None
                
            result.append({
                "gid": r["gid"],
                "name": r["name"],
                "totalLength": str(r["total_length"]),
                "completedLength": str(r["completed_length"]),
                "total_length": r["total_length"],
                "completed_length": r["completed_length"],
                "status": r["status"],
                "errorCode": r["error_code"],
                "errorMessage": r["error_message"],
                "error_code": r["error_code"],
                "error_message": r["error_message"],
                "completedTime": r["completed_time"],
                "completed_time": r["completed_time"],
                "files": files,
                "bittorrent": bittorrent,
                "files_json": r["files_json"],
                "bittorrent_json": r["bittorrent_json"]
            })
        return result
    finally:
        conn.close()

def delete_history_record(gid):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM download_history WHERE gid = ?', (gid,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def clear_history():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM download_history')
        conn.commit()
    finally:
        conn.close()

def get_task_name(task):
    bt = task.get('bittorrent', {})
    if bt and isinstance(bt, dict):
        info = bt.get('info')
        if isinstance(info, dict) and info.get('name'):
            return info['name']
    
    files = task.get('files', [])
    if files and isinstance(files, list):
        first_file = files[0]
        if isinstance(first_file, dict):
            first_file_path = first_file.get('path')
            if first_file_path:
                return os.path.basename(first_file_path)
            
            uris = first_file.get('uris', [])
            if uris and isinstance(uris, list):
                uri = uris[0]
                if isinstance(uri, dict) and uri.get('uri'):
                    return os.path.basename(uri['uri'].split('?')[0])
                    
    return "Unknown"

def upsert_history_records(tasks):
    if not tasks:
        return
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        now = int(time.time())
        for task in tasks:
            gid = task.get('gid')
            if not gid:
                continue
            name = get_task_name(task)
            
            try:
                total_length = int(task.get('totalLength', 0))
            except (ValueError, TypeError):
                total_length = 0
            try:
                completed_length = int(task.get('completedLength', 0))
            except (ValueError, TypeError):
                completed_length = 0
                
            status = task.get('status')
            error_code = task.get('errorCode')
            error_message = task.get('errorMessage')
            files_json = json.dumps(task.get('files', []))
            bittorrent_json = json.dumps(task.get('bittorrent', {}))
            
            cursor.execute('''
                INSERT INTO download_history (
                    gid, name, total_length, completed_length, status,
                    error_code, error_message, completed_time, files_json, bittorrent_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(gid) DO UPDATE SET
                    name=excluded.name,
                    total_length=excluded.total_length,
                    completed_length=excluded.completed_length,
                    status=excluded.status,
                    error_code=excluded.error_code,
                    error_message=excluded.error_message,
                    files_json=excluded.files_json,
                    bittorrent_json=excluded.bittorrent_json
            ''', (gid, name, total_length, completed_length, status, error_code, error_message, now, files_json, bittorrent_json))
        conn.commit()
    finally:
        conn.close()

def background_poller():
    while True:
        try:
            secret = os.environ.get('ARIA2_RPC_SECRET')
            rpc_payload = {
                "jsonrpc": "2.0",
                "id": "ariazero_history_poller",
                "method": "aria2.tellStopped",
                "params": [f"token:{secret}", -1, 1000] if secret else [-1, 1000]
            }
            aria2_port = os.environ.get('ARIA2_RPC_PORT', '6800')
            url = f"http://127.0.0.1:{aria2_port}/jsonrpc"
            
            headers = {"Content-Type": "application/json"}
            req_data = json.dumps(rpc_payload).encode('utf-8')
            req = urllib.request.Request(url, data=req_data, headers=headers, method="POST")
            
            with urllib.request.urlopen(req, timeout=5) as response:
                resp_data = json.loads(response.read().decode('utf-8'))
                if "result" in resp_data:
                    tasks = resp_data["result"]
                    if isinstance(tasks, list):
                        upsert_history_records(tasks)
        except Exception as e:
            pass
            
        time.sleep(2)


class DiskSpaceHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def check_auth(self):
        secret = os.environ.get('ARIA2_RPC_SECRET')
        if not secret:
            return True
        
        auth_header = self.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode('utf-8'))
            return False
        
        token = auth_header[7:]
        if token != secret:
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode('utf-8'))
            return False
        
        return True

    def do_GET(self):
        if self.path == '/api/disk':
            if not self.check_auth():
                return
            try:
                # Query disk usage for the /downloads mount
                total, used, free = shutil.disk_usage("/downloads")
                data = {
                    "total": total,
                    "used": used,
                    "free": free
                }
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path == '/api/history':
            if not self.check_auth():
                return
            try:
                records = fetch_history()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(records).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/delete-files':
            if not self.check_auth():
                return
            try:
                content_length_str = self.headers.get('Content-Length')
                if content_length_str:
                    try:
                        content_length = int(content_length_str)
                    except ValueError:
                        content_length = 0
                else:
                    content_length = 0

                if content_length > 1048576:
                    self.send_response(413)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Payload too large"}).encode('utf-8'))
                    return

                post_data = self.rfile.read(content_length)
                req_data = json.loads(post_data.decode('utf-8'))
                file_paths = req_data.get("files", [])
                
                deleted_paths = []
                errors = []
                
                downloads_dir = os.path.realpath("/downloads")
                
                for path in file_paths:
                    if not path:
                      continue
                      
                    # Security checks: ensure path starts with /downloads
                    # Normalizing path using realpath
                    real_path = os.path.realpath(path)
                    
                    if not real_path.startswith(downloads_dir):
                        errors.append(f"Forbidden path: {path}")
                        continue
                        
                    if os.path.exists(real_path) or os.path.islink(real_path):
                        try:
                            if os.path.islink(real_path):
                                os.unlink(real_path)
                                deleted_paths.append(real_path)
                            elif os.path.isdir(real_path):
                                shutil.rmtree(real_path)
                                deleted_paths.append(real_path)
                            else:
                                os.remove(real_path)
                                deleted_paths.append(real_path)
                                
                                # Clean up parent directory if empty (and not /downloads itself)
                                parent = os.path.dirname(real_path)
                                if parent != downloads_dir and parent.startswith(downloads_dir + os.sep) and os.path.exists(parent) and not os.listdir(parent):
                                    shutil.rmtree(parent)
                                    deleted_paths.append(parent)
                        except Exception as file_err:
                            errors.append(f"Error deleting {path}: {str(file_err)}")
                            
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({
                    "deleted": deleted_paths,
                    "errors": errors
                }).encode('utf-8'))
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path == '/api/history/delete':
            if not self.check_auth():
                return
            try:
                content_length_str = self.headers.get('Content-Length')
                content_length = int(content_length_str) if content_length_str else 0
                if content_length > 1048576:
                    self.send_response(413)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Payload too large"}).encode('utf-8'))
                    return
                
                post_data = self.rfile.read(content_length)
                req_data = json.loads(post_data.decode('utf-8'))
                gid = req_data.get("gid")
                if not gid:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Missing gid"}).encode('utf-8'))
                    return
                
                deleted = delete_history_record(gid)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": deleted}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path == '/api/history/clear':
            if not self.check_auth():
                return
            try:
                content_length_str = self.headers.get('Content-Length')
                content_length = int(content_length_str) if content_length_str else 0
                if content_length > 0:
                    self.rfile.read(content_length)
                
                clear_history()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run(port=8080):
    init_db()
    t = threading.Thread(target=background_poller, daemon=True)
    t.start()
    
    server_address = ('127.0.0.1', port)
    httpd = ThreadingHTTPServer(server_address, DiskSpaceHandler)
    print(f"Starting disk space API on port {port}...")
    httpd.serve_forever()

if __name__ == '__main__':
    run()
