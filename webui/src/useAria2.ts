import { useEffect, useRef, useState, useCallback } from 'react';
import { getTaskName } from './utils/taskUtils';
import { getApiUrl } from './hooks/useApiUrl';

export { getTaskName };

export interface Aria2File {
  path: string;
  length: string;
  completedLength: string;
  uris?: { uri: string; status: string }[];
}

export interface Aria2Task {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  uploadSpeed: string;
  files: Aria2File[];
  bittorrent?: {
    info?: {
      name?: string;
    };
    infoHash?: string;
    mode?: string;
    announceList?: any[][];
  };
  connections?: string;
  numSeeders?: string;
  errorCode?: string;
  errorMessage?: string;
  infoHash?: string;
  bitfield?: string;
  numPieces?: string;
}

export interface Aria2GlobalStat {
  downloadSpeed: string;
  uploadSpeed: string;
  numActive: string;
  numWaiting: string;
  numStopped: string;
}

export function formatSpeed(bytesPerSec: number | string): string {
  const bytes = Number(bytesPerSec);
  if (isNaN(bytes) || bytes === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatBytes(bytes: number | string): string {
  const b = Number(bytes);
  if (isNaN(b) || b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatETA(completed: string, total: string, speed: string): string {
  const c = Number(completed);
  const t = Number(total);
  const s = Number(speed);
  if (isNaN(c) || isNaN(t) || isNaN(s) || s <= 0 || c >= t) return '--';
  const remainingBytes = t - c;
  const seconds = Math.ceil(remainingBytes / s);
  
  if (seconds >= 3600 * 24) {
    const days = Math.floor(seconds / (3600 * 24));
    return `${days}d`;
  }
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

declare global {
  interface Window {
    AriaZeroServerConfig?: {
      rpcSecret?: string;
    };
  }
}

// Wait for config.js to load (it is injected dynamically)
function getRpcSecret(): string {
  return window.AriaZeroServerConfig?.rpcSecret || '';
}

export interface Aria2Event {
  id: string;
  type: 'complete' | 'error' | 'start' | 'pause' | 'stop';
  gid: string;
  timestamp: number;
}

export function useAria2() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [globalStat, setGlobalStat] = useState<Aria2GlobalStat>({
    downloadSpeed: '0',
    uploadSpeed: '0',
    numActive: '0',
    numWaiting: '0',
    numStopped: '0'
  });
  const [activeTasks, setActiveTasks] = useState<Aria2Task[]>([]);
  const [waitingTasks, setWaitingTasks] = useState<Aria2Task[]>([]);
  const [stoppedTasks, setStoppedTasks] = useState<Aria2Task[]>([]);
  const [globalOptions, setGlobalOptions] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<Aria2Event[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const secret = getRpcSecret();
      const headers: Record<string, string> = {};
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      const res = await fetch(getApiUrl('history'), { headers });
      if (res.ok) {
        const data = await res.json();
        setStoppedTasks(data || []);
        return data;
      } else {
        console.error('Failed to fetch history:', res.statusText);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  }, []);

  const deleteHistoryTask = useCallback(async (gid: string) => {
    try {
      const secret = getRpcSecret();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      const res = await fetch(getApiUrl('history/delete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ gid })
      });
      if (res.ok) {
        await fetchHistory();
      } else {
        console.error('Failed to delete history task:', res.statusText);
      }
    } catch (err) {
      console.error('Error deleting history task:', err);
    }
  }, [fetchHistory]);

  const clearHistoryTasks = useCallback(async () => {
    try {
      const secret = getRpcSecret();
      const headers: Record<string, string> = {};
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      const res = await fetch(getApiUrl('history/clear'), {
        method: 'POST',
        headers
      });
      if (res.ok) {
        await fetchHistory();
      } else {
        console.error('Failed to clear history tasks:', res.statusText);
      }
    } catch (err) {
      console.error('Error clearing history tasks:', err);
    }
  }, [fetchHistory]);

  useEffect(() => {
    fetchHistory();
    const timer = setInterval(fetchHistory, 4000);
    return () => clearInterval(timer);
  }, [fetchHistory]);

  // Task details and speed history states
  const [selectedGid, setSelectedGid] = useState<string | null>(null);
  const [taskPeers, setTaskPeers] = useState<any[]>([]);
  const [taskServers, setTaskServers] = useState<any[]>([]);
  const [speedHistory, setSpeedHistory] = useState<{ down: number[]; up: number[] }>({ down: [], up: [] });
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);

  const selectedGidRef = useRef<string | null>(null);

  useEffect(() => {
    selectedGidRef.current = selectedGid;
    if (!selectedGid) {
      setTaskPeers([]);
      setTaskServers([]);
    }
  }, [selectedGid]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const countdownIntervalRef = useRef<any>(null);
  const pollTimeoutRef = useRef<any>(null);
  const pendingRequestsRef = useRef<Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>>(new Map());

  // Use refs for callbacks to avoid stale closures in setInterval / setTimeout
  const sendRpcRef = useRef<(method: string, params: any[], id: string) => void>(() => {});
  const sendBatchRpcRef = useRef<(requests: { method: string; params?: any[]; id: string }[]) => void>(() => {});

  // Always read rpcSecret fresh to avoid stale closure from async config.js load
  const sendRpc = useCallback((method: string, params: any[] = [], id: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const secret = getRpcSecret();
      const payload = {
        jsonrpc: '2.0',
        id,
        method,
        params: secret ? [`token:${secret}`, ...params] : params
      };
      socketRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const sendBatchRpc = useCallback((requests: { method: string; params?: any[]; id: string }[]) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const secret = getRpcSecret();
      const payload = requests.map(r => ({
        jsonrpc: '2.0',
        id: r.id,
        method: r.method,
        params: secret ? [`token:${secret}`, ...(r.params || [])] : (r.params || [])
      }));
      socketRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // Keep refs updated
  sendRpcRef.current = sendRpc;
  sendBatchRpcRef.current = sendBatchRpc;

  const fetchGlobalOptions = useCallback(() => {
    sendRpcRef.current('aria2.getGlobalOption', [], 'getGlobalOption');
  }, []);

  const updateGlobalOptions = useCallback((options: Record<string, string>) => {
    sendRpcRef.current('aria2.changeGlobalOption', [options], 'changeGlobalOption');
    // Refresh options after a short delay
    setTimeout(() => sendRpcRef.current('aria2.getGlobalOption', [], 'getGlobalOption'), 500);
  }, []);

  const handleSingleResponse = useCallback((res: any) => {
    if (res.error) {
      console.error('RPC Error:', res.error);
      return;
    }
    const id = res.id;
    const result = res.result;

    if (id === 'globalStat') {
      setGlobalStat(result);
      const dl = Number(result.downloadSpeed) || 0;
      const ul = Number(result.uploadSpeed) || 0;
      setSpeedHistory(prev => ({
        down: [...prev.down, dl].slice(-60),
        up: [...prev.up, ul].slice(-60)
      }));
    } else if (id === 'active') {
      setActiveTasks(result || []);
    } else if (id === 'waiting') {
      setWaitingTasks(result || []);
    } else if (id === 'stopped') {
      // Handled by persistent history API
    } else if (id === 'getGlobalOption') {
      setGlobalOptions(result || {});
    } else if (id === 'getPeers') {
      setTaskPeers(result || []);
    } else if (id === 'getServers') {
      setTaskServers(result || []);
    }
  }, []);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (pendingRequestsRef.current.size > 0) {
      pendingRequestsRef.current.forEach((entry) => {
        entry.reject(new Error('WebSocket disconnected'));
      });
      pendingRequestsRef.current.clear();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setReconnectCountdown(null);
  }, []);

  const connect = useCallback(() => {
    cleanup();
    setStatus('connecting');

    // Build URL dynamically based on location
    const host = location.hostname;
    const port = location.port === '5173' ? '16980' : (location.port || (location.protocol === 'https:' ? '443' : '80'));
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${host}:${port}/jsonrpc`;

    try {
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
        setReconnectCountdown(null);
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        // Initial fetch of global options once
        sendRpcRef.current('aria2.getGlobalOption', [], 'getGlobalOption');
      };

      socket.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data);
          // Handle both batch and single responses, and aria2 notifications
          if (Array.isArray(res)) {
            res.forEach(r => {
              if (r.id && pendingRequestsRef.current.has(r.id)) {
                const promiseCallbacks = pendingRequestsRef.current.get(r.id);
                if (promiseCallbacks) {
                  if (r.error) promiseCallbacks.reject(r.error);
                  else promiseCallbacks.resolve(r.result);
                  pendingRequestsRef.current.delete(r.id);
                }
              }
              handleSingleResponse(r);
            });
          } else {
            if (res.id && pendingRequestsRef.current.has(res.id)) {
              const promiseCallbacks = pendingRequestsRef.current.get(res.id);
              if (promiseCallbacks) {
                if (res.error) promiseCallbacks.reject(res.error);
                else promiseCallbacks.resolve(res.result);
                pendingRequestsRef.current.delete(res.id);
              }
            }
            if (res.method) {
              handleAria2Notification(res);
            } else if (res.id) {
              handleSingleResponse(res);
            }
          }
        } catch (e) {
          console.error('Failed to parse RPC response:', e);
        }
      };

      socket.onclose = () => {
        setStatus('disconnected');
        if (pollTimeoutRef.current) {
          clearTimeout(pollTimeoutRef.current);
          pollTimeoutRef.current = null;
        }
        
        reconnectAttemptsRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        let secondsLeft = Math.round(delay / 1000);
        setReconnectCountdown(secondsLeft);

        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
        countdownIntervalRef.current = setInterval(() => {
          secondsLeft--;
          if (secondsLeft <= 0) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
            setReconnectCountdown(null);
          } else {
            setReconnectCountdown(secondsLeft);
          }
        }, 1000);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay) as unknown as number;
      };

      socket.onerror = (e) => {
        console.error('WebSocket error:', e);
        socket.close();
      };
    } catch (e) {
      console.error('Failed to initiate WebSocket:', e);
      setStatus('disconnected');
      
      reconnectAttemptsRef.current++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      let secondsLeft = Math.round(delay / 1000);
      setReconnectCountdown(secondsLeft);

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      countdownIntervalRef.current = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          setReconnectCountdown(null);
        } else {
          setReconnectCountdown(secondsLeft);
        }
      }, 1000);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay) as unknown as number;
    }
  }, [cleanup, handleSingleResponse]);

  useEffect(() => {
    connect();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling logic
  const poll = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const reqs: { method: string; id: string; params?: any[] }[] = [
        { method: 'aria2.getGlobalStat', id: 'globalStat' },
        { method: 'aria2.tellActive', id: 'active' },
        { method: 'aria2.tellWaiting', params: [0, 1000], id: 'waiting' }
      ];
      if (selectedGidRef.current) {
        reqs.push({ method: 'aria2.getPeers', params: [selectedGidRef.current], id: 'getPeers' });
        reqs.push({ method: 'aria2.getServers', params: [selectedGidRef.current], id: 'getServers' });
      }
      sendBatchRpcRef.current(reqs);
    }
  }, []);

  const hasActiveTasks = activeTasks.length > 0 || Number(globalStat.numActive) > 0;
  const hasActiveTasksRef = useRef(hasActiveTasks);
  useEffect(() => {
    hasActiveTasksRef.current = hasActiveTasks;
  }, [hasActiveTasks]);

  const scheduleNext = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
    }
    if (status !== 'connected') return;

    let delay = 3000;
    if (document.hidden) {
      delay = 10000;
    } else if (hasActiveTasksRef.current) {
      delay = 1000;
    }

    pollTimeoutRef.current = setTimeout(() => {
      poll();
      scheduleNext();
    }, delay);
  }, [status, poll]);

  // Start/reschedule polling on connection status changes
  useEffect(() => {
    if (status === 'connected') {
      poll();
      scheduleNext();
    }
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [status, poll, scheduleNext]);

  // Reschedule immediately on visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (status === 'connected') {
        scheduleNext();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status, scheduleNext]);

  // Reschedule immediately on active task transitions
  useEffect(() => {
    if (status === 'connected') {
      scheduleNext();
    }
  }, [hasActiveTasks, status, scheduleNext]);

  // Reschedule immediately if selected task details are required
  useEffect(() => {
    if (status === 'connected' && selectedGid) {
      poll();
      scheduleNext();
    }
  }, [selectedGid, status, poll, scheduleNext]);

  // User Actions (Promise-based)
  const addUri = useCallback((uri: string, options?: Record<string, string>) => {
    const id = `action_addUri_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.addUri', [[uri], options || {}], id);
    });
  }, []);

  const changeTaskOption = useCallback((gid: string, options: Record<string, string>) => {
    const id = `action_changeOption_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.changeOption', [gid, options], id);
    });
  }, []);

  const getTaskOptions = useCallback((gid: string) => {
    const id = `action_getOption_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.getOption', [gid], id);
    });
  }, []);

  const addTorrent = useCallback((base64: string) => {
    const id = `action_addTorrent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.addTorrent', [base64], id);
    });
  }, []);

  const pauseTask = useCallback((gid: string) => {
    const id = `action_pause_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.pause', [gid], id);
    });
  }, []);

  const resumeTask = useCallback((gid: string) => {
    const id = `action_unpause_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.unpause', [gid], id);
    });
  }, []);

  const removeTask = useCallback((gid: string, taskStatus: string) => {
    const id = `action_remove_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      if (taskStatus === 'active' || taskStatus === 'waiting' || taskStatus === 'paused') {
        sendRpcRef.current('aria2.forceRemove', [gid], id);
      } else {
        sendRpcRef.current('aria2.removeDownloadResult', [gid], id);
      }
    });
  }, []);

  const clearStopped = useCallback(() => {
    const id = `action_purge_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    clearHistoryTasks();
    return new Promise<any>((resolve, reject) => {
      pendingRequestsRef.current.set(id, { resolve, reject });
      sendRpcRef.current('aria2.purgeDownloadResult', [], id);
    });
  }, [clearHistoryTasks]);

  const handleAria2Notification = useCallback((msg: any) => {
    const method = msg.method as string;
    const gid = msg.params?.[0]?.gid as string;
    if (!gid) return;

    const typeMap: Record<string, Aria2Event['type']> = {
      'aria2.onDownloadComplete': 'complete',
      'aria2.onDownloadError': 'error',
      'aria2.onDownloadStart': 'start',
      'aria2.onDownloadPause': 'pause',
      'aria2.onDownloadStop': 'stop',
      'aria2.onBtDownloadComplete': 'complete',
    };

    const eventType = typeMap[method];
    if (eventType) {
      const event: Aria2Event = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        type: eventType,
        gid,
        timestamp: Date.now(),
      };
      setEvents(prev => [...prev, event]);
      if (eventType === 'complete' || eventType === 'error' || eventType === 'stop') {
        fetchHistory();
      }
    }
  }, [fetchHistory]);

  const acknowledgeEvent = useCallback((eventId: string) => {
    setEvents(prev => prev.filter(e => e.id !== eventId));
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    status,
    globalStat,
    activeTasks,
    waitingTasks,
    stoppedTasks,
    globalOptions,
    events,
    selectedGid,
    taskPeers,
    taskServers,
    speedHistory,
    reconnectCountdown,
    setSelectedGid,
    connect,
    addUri,
    addTorrent,
    pauseTask,
    resumeTask,
    removeTask,
    clearStopped,
    fetchGlobalOptions,
    updateGlobalOptions,
    changeTaskOption,
    getTaskOptions,
    acknowledgeEvent,
    clearEvents,
    fetchHistory,
    deleteHistoryTask,
    clearHistoryTasks
  };
}
