from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import shutil
import os
import sqlite3
import threading
import time
import urllib.request
import urllib.error
import hashlib
from urllib.parse import urlparse, parse_qs, urlencode
import xml.etree.ElementTree as ET

DB_PATH = '/config/ariazero_history.db'

hash_jobs = {}
hash_jobs_lock = threading.Lock()

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
        seen_names = set()
        for r in rows:
            name = r["name"]
            if name and name != "Unknown":
                if name in seen_names:
                    continue
                seen_names.add(name)
                
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
        # Find the name associated with this gid to delete all duplicates together
        cursor.execute('SELECT name FROM download_history WHERE gid = ?', (gid,))
        row = cursor.fetchone()
        if row and row["name"] and row["name"] != "Unknown":
            cursor.execute('DELETE FROM download_history WHERE name = ?', (row["name"],))
        else:
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
                    status=CASE WHEN download_history.status = 'complete' THEN 'complete' ELSE excluded.status END,
                    error_code=CASE WHEN download_history.status = 'complete' THEN download_history.error_code ELSE excluded.error_code END,
                    error_message=CASE WHEN download_history.status = 'complete' THEN download_history.error_message ELSE excluded.error_message END,
                    files_json=excluded.files_json,
                    bittorrent_json=excluded.bittorrent_json
            ''', (gid, name, total_length, completed_length, status, error_code, error_message, now, files_json, bittorrent_json))
        conn.commit()
    finally:
        conn.close()

def calculate_sha256_thread(file_path):
    try:
        sha256_hash = hashlib.sha256()
        total_size = os.path.getsize(file_path)
        read_size = 0
        
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(8192 * 1024), b""): # 8MB chunks
                sha256_hash.update(byte_block)
                read_size += len(byte_block)
                progress = int((read_size / total_size) * 100) if total_size > 0 else 100
                with hash_jobs_lock:
                    hash_jobs[file_path] = {
                        "status": "processing",
                        "progress": progress,
                        "read_bytes": read_size,
                        "total_bytes": total_size
                    }
                    
        hash_hex = sha256_hash.hexdigest()
        with hash_jobs_lock:
            hash_jobs[file_path] = {
                "status": "completed",
                "progress": 100,
                "hash": hash_hex,
                "total_bytes": total_size
            }
    except Exception as e:
        with hash_jobs_lock:
            hash_jobs[file_path] = {
                "status": "failed",
                "error": str(e)
            }

def get_active_aria2_paths():
    active_paths = set()
    success = False
    try:
        secret = os.environ.get('ARIA2_RPC_SECRET')
        aria2_port = os.environ.get('ARIA2_RPC_PORT', '6800')
        url = f"http://127.0.0.1:{aria2_port}/jsonrpc"
        headers = {"Content-Type": "application/json"}
        
        methods = ["aria2.tellActive", "aria2.tellWaiting", "aria2.tellStopped"]
        rpc_success_count = 0
        for method in methods:
            params = [f"token:{secret}"] if secret else []
            if method in ["aria2.tellWaiting", "aria2.tellStopped"]:
                params.extend([0, 1000])
            params.append(["gid", "status", "files", "dir", "bittorrent"])
            
            payload = {
                "jsonrpc": "2.0",
                "id": "ariazero_cleanup_poller",
                "method": method,
                "params": params
            }
            req_data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(url, data=req_data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=5) as response:
                    resp_data = json.loads(response.read().decode('utf-8'))
                    if "result" in resp_data:
                        tasks = resp_data["result"]
                        rpc_success_count += 1
                        if isinstance(tasks, list):
                            for task in tasks:
                                status = task.get("status")
                                if status in ["active", "waiting", "paused", "error"]:
                                    files = task.get("files", [])
                                    for f in files:
                                        path = f.get("path")
                                        if path:
                                            active_paths.add(os.path.realpath(path + ".aria2"))
                                    bt = task.get("bittorrent", {})
                                    if bt and isinstance(bt, dict):
                                        info = bt.get("info", {})
                                        name = info.get("name") if isinstance(info, dict) else None
                                        directory = task.get("dir")
                                        if name and directory:
                                            active_paths.add(os.path.realpath(os.path.join(directory, name + ".aria2")))
                                            active_paths.add(os.path.realpath(os.path.join(directory, name + ".torrent.aria2")))
            except Exception:
                pass
        
        if rpc_success_count > 0:
            success = True
    except Exception:
        pass
    return success, active_paths

def cleanup_orphaned_aria2_files():
    success, active_paths = get_active_aria2_paths()
    if not success:
        return
        
    downloads_dir = os.path.realpath("/downloads")
    for root, dirs, files in os.walk(downloads_dir):
        for file in files:
            if file.endswith(".aria2"):
                file_path = os.path.realpath(os.path.join(root, file))
                if file_path not in active_paths:
                    try:
                        os.remove(file_path)
                        print(f"Cleaned up orphaned control file: {file_path}")
                    except Exception as e:
                        print(f"Failed to remove control file {file_path}: {e}")

def background_poller():
    cleanup_counter = 0
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
                        
            cleanup_counter += 1
            if cleanup_counter >= 5:
                cleanup_counter = 0
                cleanup_orphaned_aria2_files()
        except Exception as e:
            print(f"Error in background_poller: {e}")
            
        time.sleep(2)



# === Jackett Integration ===

JACKETT_API_BASE = "http://127.0.0.1:9117"
JACKETT_CONFIG_PATH = "/config/jackett/ServerConfig.json"

# Cache for trending results
_trending_cache = {}
_trending_cache_time = {}
TRENDING_CACHE_TTL = 1800  # 30 minutes

def get_jackett_api_key():
    """Read the Jackett API key from its ServerConfig.json file."""
    try:
        with open(JACKETT_CONFIG_PATH, 'r') as f:
            config = json.load(f)
            return config.get("APIKey", "")
    except Exception:
        return ""

def search_jackett(query, categories=None):
    """Search torrents via Jackett's Torznab API and return parsed results."""
    api_key = get_jackett_api_key()
    if not api_key:
        return {"error": "Jackett API key not found. Please open /jackett/ to configure.", "results": []}

    params = {
        "apikey": api_key,
        "Query": query,
        "t": "search"
    }
    if categories:
        params["cat"] = categories

    url = f"{JACKETT_API_BASE}/jackett/api/v2.0/indexers/all/results/torznab/api?{urlencode(params)}"

    try:
        req = urllib.request.Request(url, headers={"Accept": "application/xml"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            xml_data = resp.read().decode('utf-8')
        return parse_torznab_xml(xml_data)
    except urllib.error.URLError as e:
        return {"error": f"Jackett connection failed: {str(e)}", "results": []}
    except Exception as e:
        return {"error": f"Search failed: {str(e)}", "results": []}

def get_trending(category="all"):
    """Get trending/top torrents. Uses cache to avoid hammering Jackett."""
    cache_key = category
    now = time.time()

    if cache_key in _trending_cache and (now - _trending_cache_time.get(cache_key, 0)) < TRENDING_CACHE_TTL:
        return _trending_cache[cache_key]

    cat_map = {
        "movies": "2000",
        "tv": "5000",
        "games": "4000",
        "music": "3000",
        "software": "4000",
        "all": ""
    }
    cat_id = cat_map.get(category, "")

    result = search_jackett("", categories=cat_id if cat_id else None)

    if "error" not in result or result.get("results"):
        result["results"] = sorted(result.get("results", []), key=lambda x: x.get("seeders", 0), reverse=True)
        result["results"] = result["results"][:50]
        _trending_cache[cache_key] = result
        _trending_cache_time[cache_key] = now

    return result

def parse_torznab_xml(xml_data):
    """Parse Torznab XML response into a clean JSON structure."""
    results = []
    try:
        root = ET.fromstring(xml_data)
        for item in root.iter('item'):
            title = item.findtext('title', '')
            size = 0
            seeders = 0
            leechers = 0
            magnet_uri = ""
            info_url = ""
            tracker = ""
            pub_date = ""
            category = ""

            size_el = item.findtext('size', '0')
            try:
                size = int(size_el)
            except (ValueError, TypeError):
                size = 0

            pub_date = item.findtext('pubDate', '')

            for attr in item.iter('{http://torznab.com/schemas/2015/feed}attr'):
                name = attr.get('name', '')
                value = attr.get('value', '')
                if name == 'seeders':
                    try:
                        seeders = int(value)
                    except (ValueError, TypeError):
                        pass
                elif name == 'peers':
                    try:
                        leechers = int(value) - seeders
                        if leechers < 0:
                            leechers = 0
                    except (ValueError, TypeError):
                        pass
                elif name == 'magneturl':
                    magnet_uri = value
                elif name == 'category':
                    category = value
                elif name == 'jackettindexer':
                    tracker = value

            enclosure = item.find('enclosure')
            if enclosure is not None and not magnet_uri:
                enc_url = enclosure.get('url', '')
                if enc_url.startswith('magnet:'):
                    magnet_uri = enc_url

            info_url = item.findtext('comments', '') or item.findtext('link', '')

            ji = item.find('jackettindexer')
            if ji is not None:
                tracker = ji.text or ji.get('id', '')
            if not tracker:
                tracker = "Unknown"

            if title:
                results.append({
                    "title": title,
                    "size": size,
                    "seeders": seeders,
                    "leechers": leechers,
                    "magnetUri": magnet_uri,
                    "infoUrl": info_url,
                    "tracker": tracker,
                    "publishDate": pub_date,
                    "category": category
                })

    except ET.ParseError as e:
        return {"error": f"Failed to parse Jackett response: {str(e)}", "results": []}

    results.sort(key=lambda x: x.get("seeders", 0), reverse=True)
    return {"results": results}

def get_jackett_status():
    """Check if Jackett is running and configured correctly."""
    api_key = get_jackett_api_key()
    if not api_key:
        return {"running": False, "message": "Jackett API key not found. Jackett may still be starting up. Visit /jackett/ to configure."}

    try:
        url = f"{JACKETT_API_BASE}/jackett/api/v2.0/indexers/all/results/torznab/api?apikey={api_key}&t=caps"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.getcode() == 200:
                return {
                    "running": True,
                    "message": "Jackett is running and authenticated successfully."
                }
            else:
                return {"running": False, "message": f"Jackett returned status code: {resp.getcode()}"}
    except Exception as e:
        return {"running": False, "message": f"Cannot connect to Jackett: {str(e)}"}



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
        elif self.path.startswith('/api/file-hash/status'):
            if not self.check_auth():
                return
            try:
                query = parse_qs(urlparse(self.path).query)
                path_list = query.get('path')
                file_path = path_list[0] if path_list else None
                
                if not file_path:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Missing path parameter"}).encode('utf-8'))
                    return
                    
                with hash_jobs_lock:
                    job = hash_jobs.get(file_path, {"status": "not_started"})
                    
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(job).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path.startswith('/api/search'):
            if not self.check_auth():
                return
            try:
                query_params = parse_qs(urlparse(self.path).query)
                q = query_params.get('q', [''])[0]
                cat = query_params.get('cat', [''])[0]

                if not q:
                    result = {"error": "Missing search query parameter 'q'", "results": []}
                else:
                    result = search_jackett(q, categories=cat if cat else None)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path.startswith('/api/trending'):
            if not self.check_auth():
                return
            try:
                query_params = parse_qs(urlparse(self.path).query)
                cat = query_params.get('cat', ['all'])[0]
                result = get_trending(cat)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        elif self.path == '/api/jackett-status':
            if not self.check_auth():
                return
            try:
                result = get_jackett_status()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(result).encode('utf-8'))
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
        elif self.path == '/api/file-hash':
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
                file_path = req_data.get("path")
                
                if not file_path:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Missing path"}).encode('utf-8'))
                    return
                    
                # Security check
                downloads_dir = os.path.realpath("/downloads")
                real_path = os.path.realpath(file_path)
                if not real_path.startswith(downloads_dir):
                    self.send_response(403)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Forbidden path"}).encode('utf-8'))
                    return
                    
                if not os.path.exists(real_path) or os.path.isdir(real_path):
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "File not found"}).encode('utf-8'))
                    return
                
                with hash_jobs_lock:
                    job = hash_jobs.get(real_path)
                    if not job or job.get("status") in ["failed", "completed"]:
                        hash_jobs[real_path] = {"status": "processing", "progress": 0}
                        t = threading.Thread(target=calculate_sha256_thread, args=(real_path,), daemon=True)
                        t.start()
                        job = hash_jobs[real_path]
                        
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(job).encode('utf-8'))
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
