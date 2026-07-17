from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import shutil
import os
import sqlite3
import threading
import time
import urllib.request
import urllib.error
import hashlib
from urllib.parse import urlparse, parse_qs, urlencode, quote
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = '/config/ariazero_history.db'
OMDB_API_KEY = os.environ.get('OMDB_API_KEY', '2b2ca076')
OMDB_CACHE_TTL = 604800  # 7 days in seconds

hash_jobs = {}
hash_jobs_lock = threading.Lock()

# Blocklist of GIDs that have been explicitly deleted by the user.
# The background poller checks this set and skips these GIDs to prevent
# re-inserting them into SQLite before aria2 finishes processing the removal.
_deleted_gids = set()
_deleted_gids_lock = threading.Lock()

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
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS movie_metadata_cache (
                search_key TEXT PRIMARY KEY,
                title TEXT,
                year TEXT,
                genre TEXT,
                rt_score TEXT,
                plot TEXT,
                poster TEXT,
                cached_at INTEGER
            )
        ''')
        conn.commit()
    finally:
        conn.close()

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

def call_aria2_rpc(method, params):
    try:
        secret = os.environ.get('ARIA2_RPC_SECRET')
        aria2_port = os.environ.get('ARIA2_RPC_PORT', '6800')
        url = f"http://127.0.0.1:{aria2_port}/jsonrpc"
        headers = {"Content-Type": "application/json"}
        
        rpc_params = [f"token:{secret}"] if secret else []
        rpc_params.extend(params)
        
        payload = {
            "jsonrpc": "2.0",
            "id": "ariazero_rpc_helper",
            "method": method,
            "params": rpc_params
        }
        req_data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=req_data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error in call_aria2_rpc {method}: {e}")
        return None

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
    # Add to blocklist FIRST to prevent background poller race condition
    with _deleted_gids_lock:
        _deleted_gids.add(gid)

    # Try forceRemove first (handles active/waiting/paused tasks)
    result = call_aria2_rpc("aria2.forceRemove", [gid])
    if result and "result" in result:
        # forceRemove succeeded - task is transitioning to stopped state.
        # Wait briefly for aria2 to fully transition the task.
        time.sleep(0.3)
    
    # Remove from stopped list (handles complete/error/removed tasks)
    result = call_aria2_rpc("aria2.removeDownloadResult", [gid])
    if result is None or "error" in str(result):
        # Retry after a short delay in case the task hasn't fully transitioned
        time.sleep(0.3)
        call_aria2_rpc("aria2.removeDownloadResult", [gid])
    
    # Force save the session file immediately
    call_aria2_rpc("aria2.saveSession", [])

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        # Find the name associated with this gid to delete all duplicates together
        cursor.execute('SELECT name FROM download_history WHERE gid = ?', (gid,))
        row = cursor.fetchone()
        deleted_gids_from_db = []
        if row and row["name"] and row["name"] != "Unknown":
            # Also find all related GIDs to add to blocklist
            cursor.execute('SELECT gid FROM download_history WHERE name = ?', (row["name"],))
            deleted_gids_from_db = [r["gid"] for r in cursor.fetchall()]
            cursor.execute('DELETE FROM download_history WHERE name = ?', (row["name"],))
        else:
            cursor.execute('DELETE FROM download_history WHERE gid = ?', (gid,))
        conn.commit()
        
        # Add all related GIDs to blocklist and remove from aria2
        for related_gid in deleted_gids_from_db:
            with _deleted_gids_lock:
                _deleted_gids.add(related_gid)
            if related_gid != gid:
                call_aria2_rpc("aria2.forceRemove", [related_gid])
                call_aria2_rpc("aria2.removeDownloadResult", [related_gid])
        
        if deleted_gids_from_db:
            call_aria2_rpc("aria2.saveSession", [])
        
        return cursor.rowcount > 0
    finally:
        conn.close()

def clear_history():
    # Add all existing history GIDs to blocklist
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT gid FROM download_history')
        with _deleted_gids_lock:
            for r in cursor.fetchall():
                _deleted_gids.add(r["gid"])
    finally:
        conn.close()

    # Purge all stopped/completed tasks from aria2 memory
    call_aria2_rpc("aria2.purgeDownloadResult", [])
    
    # Force save the session file immediately
    call_aria2_rpc("aria2.saveSession", [])

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
            # Skip GIDs that have been explicitly deleted by the user
            with _deleted_gids_lock:
                if gid in _deleted_gids:
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
TRENDING_CACHE_TTL = 21600  # 6 hours

def trending_poller():
    """Periodically pre-fetch trending data every 6 hours so it loads instantly for the user."""
    # Initial delay to let the server start up and Jackett to be ready
    time.sleep(10)
    while True:
        try:
            print("Pre-fetching trending data in background...")
            get_trending(category="movies", force_refresh=True)
            get_trending(category="tv", force_refresh=True)
            get_trending(category="games", force_refresh=True)
            print("Trending data pre-fetched successfully.")
        except Exception as e:
            print(f"Error in trending_poller: {e}")
        # Sleep for 6 hours
        time.sleep(21600)

def get_jackett_api_key():
    """Read the Jackett API key from its ServerConfig.json file."""
    try:
        with open(JACKETT_CONFIG_PATH, 'r') as f:
            config = json.load(f)
            return config.get("APIKey", "")
    except Exception:
        return ""

def search_jackett(query, categories=None, t="search"):
    """Search torrents via Jackett's Torznab API and return parsed results."""
    api_key = get_jackett_api_key()
    if not api_key:
        return {"error": "Jackett API key not found. Please open /jackett/ to configure.", "results": []}

    params = {
        "apikey": api_key,
        "q": query,
        "t": t
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

def fetch_apibay_top100(category_id):
    """Directly fetch Top 100 torrents from apibay.org for a specific category."""
    url = f"https://apibay.org/precompiled/data_top100_{category_id}.json"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        
        results = []
        for item in data:
            name = item.get("name", "")
            if not name or name == "No torrents found":
                continue
            
            info_hash = item.get("info_hash", "")
            if not info_hash or info_hash == "0000000000000000000000000000000000000000":
                continue
                
            magnet = f"magnet:?xt=urn:btih:{info_hash}&dn={quote(name)}"
            # Add some standard public trackers
            trackers = [
                "udp://tracker.opentrackr.org:1337/announce",
                "udp://open.demonii.com:1337/announce",
                "udp://open.stealth.si:80/announce",
                "udp://tracker.torrent.eu.org:451/announce"
            ]
            for tr in trackers:
                magnet += f"&tr={quote(tr)}"
                
            try:
                size = int(item.get("size", 0))
                seeders = int(item.get("seeders", 0))
                leechers = int(item.get("leechers", 0))
            except:
                size = 0
                seeders = 0
                leechers = 0
                
            pub_date = ""
            try:
                added = int(item.get("added", 0))
                if added:
                    pub_date = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(added))
            except:
                pass
                
            results.append({
                "title": name,
                "size": size,
                "seeders": seeders,
                "leechers": leechers,
                "magnetUri": magnet,
                "infoUrl": f"https://thepiratebay.org/description.php?id={item.get('id')}",
                "tracker": "The Pirate Bay",
                "publishDate": pub_date,
                "category": item.get("category", "")
            })
        return results
    except Exception as e:
        print(f"Failed to fetch apibay top 100 for category {category_id}: {e}")
        return []

def get_movie_dedup_key(title):
    """Generate a deduplication key for movies based on title and year."""
    match = re.search(r'[\s\.\(\[-](19\d{2}|20\d{2})[\s\.\)\]-]', title)
    if match:
        year = match.group(1)
        idx = match.start()
        title_prefix = title[:idx]
        clean_title = re.sub(r'[^a-zA-Z0-9]', '', title_prefix).lower()
        if clean_title:
            return f"{clean_title}_{year}"
            
    # Fallback: strip common resolution and codec tags
    clean_title = re.sub(r'(1080p|720p|2160p|4k|hdrip|webrip|brrip|bluray|x264|x265|hevc|dd5|dts|h264|h265|aac).*', '', title, flags=re.IGNORECASE)
    clean_title = re.sub(r'[^a-zA-Z0-9]', '', clean_title).lower()
    return clean_title

def get_tv_dedup_key(title):
    """Generate a deduplication key for TV shows based on title and season."""
    match = re.search(r'(?i)[\s\.\(\[-](s\d{1,2}|season\s?\d{1,2})', title)
    if match:
        season = match.group(1).lower()
        idx = match.start()
        title_prefix = title[:idx]
        clean_title = re.sub(r'[^a-zA-Z0-9]', '', title_prefix).lower()
        if clean_title:
            return f"{clean_title}_{season}"
    return get_movie_dedup_key(title)

def extract_clean_title(torrent_title, category="movies"):
    """Extract a clean movie/TV title and year from a torrent filename.
    
    Examples:
      'Obsession.2026.1080p.AMZN.WEB-DL.DDP5.1.H264.MP4-BTM' → ('Obsession', '2026')
      'Project Hail Mary (2026) [1080p] [WEBRip] [5.1]' → ('Project Hail Mary', '2026')
      'Rick and Morty S09E07 1080p WEB h264-EDITH' → ('Rick and Morty', None)
      'House of the Dragon S03E03 1080p WEB h264-ETHEL' → ('House of the Dragon', None)
    """
    title = torrent_title.strip()
    year = None
    
    # Try to extract year
    year_match = re.search(r'[\s\.\(\[-]((?:19|20)\d{2})[\s\.\)\]-]', title)
    if year_match:
        year = year_match.group(1)
        title = title[:year_match.start()]
    
    # For TV shows, cut at SxxExx or Season marker
    if category == "tv":
        tv_match = re.search(r'(?i)[\s\.\(\[-](?:s\d{1,2}|season\s?\d{1,2})', title)
        if tv_match:
            title = title[:tv_match.start()]
    
    # If no year found and no TV marker, cut at common resolution/codec tags
    if not year and category != "tv":
        codec_match = re.search(r'(?i)[\s\.\(\[-](?:1080p|720p|2160p|4k|hdrip|webrip|brrip|bluray|x264|x265|hevc|web|dvdrip|hdtv)', title)
        if codec_match:
            title = title[:codec_match.start()]
    
    # Clean up: replace dots/underscores with spaces, strip junk
    title = re.sub(r'[\._]', ' ', title)
    title = re.sub(r'\s+', ' ', title).strip()
    # Remove trailing dashes and group tags
    title = re.sub(r'\s*[-]\s*\w+$', '', title).strip()
    
    return (title, year) if title else (torrent_title, None)

def _get_omdb_cache_key(title, year=None, media_type='movie'):
    """Generate a normalized cache key for OMDb lookups."""
    clean = re.sub(r'[^a-zA-Z0-9 ]', '', title).lower().strip()
    key = f"{media_type}:{clean}"
    if year:
        key += f":{year}"
    return key

def fetch_omdb_metadata(title, year=None, media_type='movie', omdb_key=None):
    """Query OMDb API for movie/TV metadata. Returns cached result if available.
    
    Returns dict with keys: genre, rtScore, plot, poster (or empty dict on failure).
    """
    key_to_use = omdb_key or OMDB_API_KEY
    if not key_to_use:
        return {}
    
    cache_key = _get_omdb_cache_key(title, year, media_type)
    
    # Check SQLite cache first
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT genre, rt_score, plot, poster, cached_at FROM movie_metadata_cache WHERE search_key = ?',
            (cache_key,)
        )
        row = cursor.fetchone()
        conn.close()
        
        if row and (time.time() - row['cached_at']) < OMDB_CACHE_TTL:
            result = {}
            if row['genre']: result['genre'] = row['genre']
            if row['rt_score']: result['rtScore'] = row['rt_score']
            if row['plot']: result['plot'] = row['plot']
            if row['poster'] and row['poster'] != 'N/A': result['poster'] = row['poster']
            return result
    except Exception as e:
        print(f"OMDb cache read error: {e}")
    
    # Query OMDb API
    try:
        params = {'apikey': key_to_use, 't': title, 'type': media_type, 'plot': 'short'}
        if year:
            params['y'] = year
        
        api_url = f"http://www.omdbapi.com/?{urlencode(params)}"
        req = urllib.request.Request(api_url, headers={
            'User-Agent': 'AriaZero/1.2'
        })
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        
        if data.get('Response') != 'True':
            # Try without year as fallback
            if year:
                params.pop('y', None)
                api_url = f"http://www.omdbapi.com/?{urlencode(params)}"
                req = urllib.request.Request(api_url, headers={'User-Agent': 'AriaZero/1.2'})
                with urllib.request.urlopen(req, timeout=6) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
            
            if data.get('Response') != 'True':
                # Cache the miss to avoid re-querying
                _store_omdb_cache(cache_key, '', '', '', '')
                return {}
        
        genre = data.get('Genre', '')
        plot = data.get('Plot', '')
        poster = data.get('Poster', '')
        
        # Extract Rotten Tomatoes score from Ratings array
        rt_score = ''
        for rating in data.get('Ratings', []):
            if rating.get('Source') == 'Rotten Tomatoes':
                rt_score = rating.get('Value', '')
                break
                
        # Fallback to IMDb rating if Rotten Tomatoes is missing
        if not rt_score:
            imdb = data.get('imdbRating', '')
            if imdb and imdb != 'N/A':
                rt_score = f"IMDb:{imdb}"
        
        # Cache the result
        _store_omdb_cache(cache_key, genre, rt_score, plot, poster)
        
        result = {}
        if genre and genre != 'N/A': result['genre'] = genre
        if rt_score: result['rtScore'] = rt_score
        if plot and plot != 'N/A': result['plot'] = plot
        if poster and poster != 'N/A': result['poster'] = poster
        return result
        
    except Exception as e:
        print(f"OMDb API error for '{title}': {e}")
        return {}

def _store_omdb_cache(cache_key, genre, rt_score, plot, poster):
    """Store metadata in SQLite cache."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO movie_metadata_cache 
            (search_key, genre, rt_score, plot, poster, cached_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (cache_key, genre, rt_score, plot, poster, int(time.time())))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"OMDb cache write error: {e}")

def enrich_trending_with_metadata(results, category, omdb_key=None):
    """Enrich trending torrent results with movie metadata from OMDb.
    
    Only enriches movies and TV shows (not games).
    Uses ThreadPoolExecutor for parallel lookups.
    """
    key_to_use = omdb_key or OMDB_API_KEY
    if category not in ('movies', 'tv') or not key_to_use:
        return results
    
    media_type = 'movie' if category == 'movies' else 'series'
    
    def enrich_single(item):
        title = item.get('title', '')
        
        # Auto-detect TV episodes even in movies category (SxxExx pattern)
        is_tv_episode = bool(re.search(r'(?i)s\d{1,2}e\d{1,2}', title))
        actual_media_type = 'series' if is_tv_episode else media_type
        actual_category = 'tv' if is_tv_episode else category
        
        clean_title, year = extract_clean_title(title, actual_category)
        if not clean_title:
            return item
        
        metadata = fetch_omdb_metadata(clean_title, year, actual_media_type, key_to_use)
        if metadata:
            enriched = dict(item)
            enriched.update(metadata)
            return enriched
        return item
    
    # Run lookups in parallel (max 5 concurrent to be nice to OMDb)
    enriched_results = [None] * len(results)
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_idx = {executor.submit(enrich_single, item): idx for idx, item in enumerate(results)}
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                enriched_results[idx] = future.result()
            except Exception:
                enriched_results[idx] = results[idx]
    
    return enriched_results

def get_trending(category="all", omdb_key=None, force_refresh=False):
    """Get trending/top torrents. Uses cache to avoid hammering Jackett."""
    cache_key = category
    now = time.time()

    if not force_refresh and cache_key in _trending_cache and (now - _trending_cache_time.get(cache_key, 0)) < TRENDING_CACHE_TTL:
        return _trending_cache[cache_key]

    results = []

    # 1. Fetch from apibay.org (The Pirate Bay) directly for precise Top 100 lists
    apibay_results = []
    if category == "movies":
        apibay_results += fetch_apibay_top100("201")
        apibay_results += fetch_apibay_top100("207")  # 207 is HD - Movies, 200 is All Video (includes TV)
    elif category == "tv":
        apibay_results += fetch_apibay_top100("208")
        apibay_results += fetch_apibay_top100("205")
    elif category == "games":
        apibay_results += fetch_apibay_top100("400")
        
    results += apibay_results

    # 2. Fetch from Jackett (YTS, LimeTorrents, eztv)
    cat_map = {
        "movies": "2000",
        "tv": "5000",
        "games": "4000",
        "music": "3000",
        "software": "4000",
        "all": ""
    }
    cat_id = cat_map.get(category, "")

    t_type = "movie" if category == "movies" else ("tvsearch" if category == "tv" else "search")
    cat_to_pass = cat_id if cat_id else None

    jackett_res = search_jackett("", categories=cat_to_pass, t=t_type)
    if "results" in jackett_res:
        results += jackett_res["results"]

    # 3. Sort by seeders descending FIRST so we always keep the highest seeded release
    results.sort(key=lambda x: x.get("seeders", 0), reverse=True)

    # 4. Filter duplicates (by magnet, title, resolution key) and non-English releases
    seen_magnets = set()
    seen_titles = set()
    seen_dedup_keys = set()
    filtered_results = []
    
    # Exclude CJK (Chinese/Japanese/Korean) and Cyrillic (Russian) characters to ensure English-only titles
    english_only_pattern = re.compile(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7a3\u0400-\u04ff]')
    # Regex to detect TV show patterns: S01E01, Season 1, etc.
    tv_pattern = re.compile(r'(?i)\bS\d{1,2}E\d{1,2}\b|\bSeason\s*\d+\b')

    for item in results:
        title = item.get("title", "")
        # Filter non-English titles
        if english_only_pattern.search(title):
            continue
            
        # Filter out TV shows if we are requesting movies
        if category == "movies" and tv_pattern.search(title):
            continue

        magnet = item.get("magnetUri", "")
        title_lower = title.lower().strip()
        
        # Determine deduplication key
        if category == "tv":
            dedup_key = get_tv_dedup_key(title)
        else:
            dedup_key = get_movie_dedup_key(title)
            
        # Avoid duplicate matches
        if magnet in seen_magnets or title_lower in seen_titles or dedup_key in seen_dedup_keys:
            continue
            
        seen_magnets.add(magnet)
        seen_titles.add(title_lower)
        seen_dedup_keys.add(dedup_key)
        filtered_results.append(item)
    # Enrich with OMDb metadata (genre, RT score, plot, poster) for movies/TV
    top_results = filtered_results[:50]
    top_results = enrich_trending_with_metadata(top_results, category, omdb_key)

    result = {"results": top_results}
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
                omdb_key = self.headers.get('X-OMDb-API-Key') or self.headers.get('x-omdb-api-key') or OMDB_API_KEY
                result = get_trending(cat, omdb_key)

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
    
    # Start the trending poller to pre-fetch data every 6 hours
    t2 = threading.Thread(target=trending_poller, daemon=True)
    t2.start()
    
    server_address = ('127.0.0.1', port)
    httpd = ThreadingHTTPServer(server_address, DiskSpaceHandler)
    print(f"Starting disk space API on port {port}...")
    httpd.serve_forever()

if __name__ == '__main__':
    run()
