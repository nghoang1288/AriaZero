import type { Aria2Task } from '../useAria2';

export function getTaskName(task: Aria2Task): string {
  if (task.bittorrent?.info?.name) {
    return task.bittorrent.info.name;
  }
  const filePath = task.files?.[0]?.path;
  if (filePath) {
    const parts = filePath.split(/[/\\]/);
    const name = parts[parts.length - 1];
    if (name) return name;
  }
  const uri = task.files?.[0]?.uris?.[0]?.uri;
  if (uri) {
    const parts = uri.split('/');
    const name = parts[parts.length - 1].split('?')[0];
    if (name) return decodeURIComponent(name);
  }
  return 'Downloading Task...';
}

export function getFileExtension(filename: string): string {
  const name = filename.toLowerCase();
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export const isVideo = (ext: string) =>
  ['mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm'].includes(ext.toLowerCase());

export const isAudio = (ext: string) =>
  ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(ext.toLowerCase());

export const isDoc = (ext: string) =>
  ['pdf', 'docx', 'doc', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub'].includes(ext.toLowerCase());

export const isSoftware = (ext: string) =>
  ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'zip', 'rar', '7z', 'tar', 'gz'].includes(ext.toLowerCase());

export const isTorrent = (task: Aria2Task) => {
  return !!task.bittorrent && Object.keys(task.bittorrent).length > 0;
};

// A task is seeding if it is active, is a torrent, and completedLength >= totalLength
export const isTaskSeeding = (task: Aria2Task) => {
  const hasBt = !!task.bittorrent && Object.keys(task.bittorrent).length > 0;
  return task.status === 'active' && 
    hasBt && 
    Number(task.totalLength) > 0 && 
    Number(task.completedLength) >= Number(task.totalLength);
};

// A torrent is completed (can be seeding or seeding-paused/complete)
export const isTorrentCompleted = (task: Aria2Task) => {
  const hasBt = !!task.bittorrent && Object.keys(task.bittorrent).length > 0;
  return hasBt && 
    Number(task.totalLength) > 0 && 
    Number(task.completedLength) >= Number(task.totalLength);
};

// Identify completed metadata tasks to hide them
export const isMetadataTask = (task: Aria2Task) => {
  // Do not hide active or waiting metadata downloads
  if (task.status === 'active' || task.status === 'waiting') {
    return false;
  }
  const name = getTaskName(task).toLowerCase();
  const hasBt = !!task.bittorrent && Object.keys(task.bittorrent).length > 0;
  return name.includes('[metadata]') || 
         name.includes('metadata') ||
         (task as any).followedBy !== undefined ||
         (hasBt && !task.bittorrent?.info);
};

export function filterTaskByCategory(task: Aria2Task, category: string): boolean {
  if (isMetadataTask(task)) return false;
  const ext = getFileExtension(getTaskName(task));
  switch (category) {
    case 'active':
      return (task.status === 'active' || task.status === 'waiting') && !isTorrentCompleted(task);
    case 'completed':
      return task.status === 'complete' || isTorrentCompleted(task);
    case 'torrents':
      return isTorrent(task);
    case 'video':
      return isVideo(ext);
    case 'audio':
      return isAudio(ext);
    case 'documents':
      return isDoc(ext);
    case 'software':
      return isSoftware(ext);
    case 'all':
    default:
      return true;
  }
}

export function getFileCategory(filename: string): 'video' | 'audio' | 'documents' | 'software' | 'other' {
  const ext = getFileExtension(filename);
  if (isVideo(ext)) return 'video';
  if (isAudio(ext)) return 'audio';
  if (isDoc(ext)) return 'documents';
  if (isSoftware(ext)) return 'software';
  return 'other';
}

export function sanitizeMagnetLink(uri: string): string {
  let clean = uri.trim();
  if (!clean.toLowerCase().startsWith('magnet:')) {
    return clean;
  }
  
  // Normalize to NFC to ensure robust matching on both Windows (NFC) and macOS/iOS (NFD) inputs
  clean = clean.normalize('NFC');
  
  // Fix Telex / typing typos in magnet:?xt=urn:btih
  clean = clean.replace(/xt[ủư]n:btih:?/i, 'xt=urn:btih:');
  clean = clean.replace(/xt=[ủư]n:btih:?/i, 'xt=urn:btih:');
  clean = clean.replace(/xt:btih:?/i, 'xt=urn:btih:');
  clean = clean.replace(/xt=btih:?/i, 'xt=urn:btih:');
  
  // Fix missing '=' in query parameters (e.g. '&dnThe' -> '&dn=The', '&trudp' -> '&tr=udp')
  clean = clean.replace(/&dn([^=])/gi, '&dn=$1');
  clean = clean.replace(/&tr([^=])/gi, '&tr=$1');
  
  // Fix Vietnamese diacritic typos in common tracker domains (e.g. 'ỏg' -> 'org')
  // Collapse any leading dots or hyphens (like '.-ỏg', '-ỏg', '.ỏg') into '.org' / '.de'
  clean = clean.replace(/[\.\-]+ỏg/gi, '.org');
  clean = clean.replace(/[\.\-]+đ/gi, '.de');
  clean = clean.replace(/lecherspẩdise/gi, 'leechersparadise');
  
  // Strip trailing junk characters (like trailing =, -, + from copy-paste)
  clean = clean.replace(/[=\-+]+$/, '');
  
  return clean;
}

