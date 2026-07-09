import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  ArrowDown, 
  ArrowUp, 
  Plus, 
  Search, 
  Sun, 
  Moon, 
  Folder, 
  Activity, 
  Menu,
  Eye,
  EyeOff,
  Link,
  X,
  CheckCircle,
  Share2,
  Film,
  Music,
  FileText,
  Box,
  AlertCircle,
  Settings
} from 'lucide-react';
import { useAria2, formatBytes, formatSpeed } from './useAria2';
import type { Aria2Task, Aria2GlobalStat } from './useAria2';
import SettingsPanel from './SettingsPanel';
import { SmartDownloadProvider, useSmartDownload } from './SmartDownload';
import { useToast } from './Toast';
import { useApiUrl } from './hooks/useApiUrl';
import { 
  getTaskName, 
  getFileExtension,
  isTorrentCompleted, 
  isTorrent, 
  isAudio, 
  isVideo, 
  isDoc, 
  isSoftware, 
  isMetadataTask,
  getFileCategory,
  sanitizeMagnetLink
} from './utils/taskUtils';

import ConfirmModal from './components/ConfirmModal';
import AddDownloadModal from './components/AddDownloadModal';
import TaskDetailsDrawer from './components/TaskDetailsDrawer';
import DashboardPage from './components/DashboardPage';
import DownloadsPage from './components/DownloadsPage';
import Sparkline from './components/Sparkline';
import SearchTorrentsPage from './components/SearchTorrentsPage';

function App() {
  const {
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
    deleteHistoryTask,
    clearHistoryTasks
  } = useAria2();

  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'dashboard' | 'downloads' | 'search' | 'settings'>('dashboard');
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('ariazero_theme') as 'dark' | 'light') || 'dark';
  });

  const [modalInitialUris, setModalInitialUris] = useState('');
  const [modalInitialMode, setModalInitialMode] = useState<'link' | 'torrent'>('link');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('ariazero_theme', next);
  };

  // Wrap addUri with auto-categorization options
  const addUriWithCategory = useCallback((uri: string, options?: Record<string, string>) => {
    const sanitizedUri = sanitizeMagnetLink(uri);
    const autoCategorizeEnabled = localStorage.getItem('ariazero_auto_categorize_enabled') !== 'false';
    const baseDir = globalOptionsRef.current.dir || '';

    let mergedOptions = { ...options };
    if (autoCategorizeEnabled && baseDir) {
      let filename = '';
      try {
        const cleanUri = sanitizedUri.split('?')[0].split('#')[0];
        const parts = cleanUri.split('/');
        filename = decodeURIComponent(parts[parts.length - 1] || '');
      } catch (e) {
        const parts = sanitizedUri.split('/');
        filename = decodeURIComponent(parts[parts.length - 1] || '');
      }

      if (filename) {
        const category = getFileCategory(filename);
        let subfolder = '';
        if (category === 'video') subfolder = localStorage.getItem('ariazero_video_folder') || 'Video';
        else if (category === 'audio') subfolder = localStorage.getItem('ariazero_audio_folder') || 'Audio';
        else if (category === 'documents') subfolder = localStorage.getItem('ariazero_doc_folder') || 'Documents';
        else if (category === 'software') subfolder = localStorage.getItem('ariazero_software_folder') || 'Software';

        if (subfolder) {
          const cleanBaseDir = baseDir.replace(/[/\\]$/, '');
          mergedOptions.dir = `${cleanBaseDir}/${subfolder}`;
        }
      }
    }
    return addUri(sanitizedUri, mergedOptions);
  }, [addUri]);

  // Smart download handler: when a link is detected from clipboard/magnet/drag
  const handleLinkDetected = useCallback((url: string, source?: 'url_param' | 'clipboard' | 'drag') => {
    if (source === 'url_param') {
      setModalInitialUris(url);
      setModalInitialMode('link');
      setShowAddModal(true);
      showToast({
        type: 'info',
        title: 'Magnet Link Detected',
        message: 'Opened download popup',
        duration: 3000,
      });
    } else {
      showToast({
        type: 'info',
        title: 'Link Detected',
        message: url.length > 60 ? url.slice(0, 60) + '…' : url,
        action: {
          label: 'Download Now',
          onClick: () => {
            addUriWithCategory(url);
            showToast({
              type: 'success',
              title: 'Download Started',
              message: 'Task added to queue',
            });
          },
        },
        duration: 8000,
      });
    }
  }, [addUriWithCategory, showToast]);

  const handleTorrentDetected = useCallback((base64: string, filename: string) => {
    showToast({
      type: 'info',
      title: 'Torrent File Detected',
      message: filename,
      action: {
        label: 'Download Now',
        onClick: () => {
          addTorrent(base64);
          showToast({
            type: 'success',
            title: 'Torrent Download Started',
            message: 'Adding torrent to queue',
          });
        },
      },
      duration: 8000,
    });
  }, [addTorrent, showToast]);

  // Keep a ref of globalOptions to prevent scheduler teardown/recreate loops
  const globalOptionsRef = useRef(globalOptions);
  useEffect(() => {
    globalOptionsRef.current = globalOptions;
  }, [globalOptions]);

  // Bandwidth Scheduler execution
  useEffect(() => {
    let config = {
      enabled: false,
      start: '08:00',
      end: '18:00',
      dlLimit: '500K',
      ulLimit: '50K',
      dlNormal: '0',
      ulNormal: '0'
    };

    const loadConfig = () => {
      config = {
        enabled: localStorage.getItem('ariazero_scheduler_enabled') === 'true',
        start: localStorage.getItem('ariazero_scheduler_start') || '08:00',
        end: localStorage.getItem('ariazero_scheduler_end') || '18:00',
        dlLimit: localStorage.getItem('ariazero_scheduler_dl_limit') || '500K',
        ulLimit: localStorage.getItem('ariazero_scheduler_ul_limit') || '50K',
        dlNormal: localStorage.getItem('ariazero_scheduler_dl_normal') || '0',
        ulNormal: localStorage.getItem('ariazero_scheduler_ul_normal') || '0'
      };
    };

    const checkScheduler = () => {
      if (!config.enabled) return;

      const now = new Date();
      const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      let isInside = false;
      if (config.start <= config.end) {
        isInside = current >= config.start && current < config.end;
      } else {
        isInside = current >= config.start || current < config.end;
      }

      const targetDl = isInside ? config.dlLimit : config.dlNormal;
      const targetUl = isInside ? config.ulLimit : config.ulNormal;

      const currentOptions = globalOptionsRef.current;
      const currentDl = currentOptions['max-overall-download-limit'];
      const currentUl = currentOptions['max-overall-upload-limit'];

      // Only update if there's a difference and options are loaded
      if (Object.keys(currentOptions).length > 0 && (currentDl !== targetDl || currentUl !== targetUl)) {
        updateGlobalOptions({
          'max-overall-download-limit': targetDl,
          'max-overall-upload-limit': targetUl
        });
        showToast({
          type: 'info',
          title: 'Scheduler Limit Applied',
          message: `DL: ${targetDl === '0' ? 'Unlimited' : targetDl} | UL: ${targetUl === '0' ? 'Unlimited' : targetUl}`,
        });
      }
    };

    const handleConfigChange = () => {
      loadConfig();
      checkScheduler();
    };

    // Load initially and check
    loadConfig();
    checkScheduler();
    
    // Check every 10s (only time comparison, no localStorage reads!)
    const timer = setInterval(checkScheduler, 10000);

    // Listen for scheduler change events from the SettingsPanel
    window.addEventListener('ariazero_scheduler_changed', handleConfigChange);

    return () => {
      clearInterval(timer);
      window.removeEventListener('ariazero_scheduler_changed', handleConfigChange);
    };
  }, [updateGlobalOptions, showToast]);

  // Events effect has been moved to AppContent to access retryTask and sound alerts easily.

  // Request browser notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 mr-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
            Connected
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            Connecting...
          </span>
        );
      case 'disconnected':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5 mr-1" />
            Disconnected
          </span>
        );
    }
  };

  const allActiveAndWaiting = useMemo(() => [...activeTasks, ...waitingTasks], [activeTasks, waitingTasks]);

  return (
    <SmartDownloadProvider onLinkDetected={handleLinkDetected} onTorrentDetected={handleTorrentDetected}>
      <AppContent
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        showAddModal={showAddModal}
        setShowAddModal={setShowAddModal}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        getStatusBadge={getStatusBadge}
        globalStat={globalStat}
        activeTasks={activeTasks}
        waitingTasks={waitingTasks}
        stoppedTasks={stoppedTasks}
        allActiveAndWaiting={allActiveAndWaiting}
        status={status}
        globalOptions={globalOptions}
        pauseTask={pauseTask}
        resumeTask={resumeTask}
        removeTask={removeTask}
        clearStopped={clearStopped}
        fetchGlobalOptions={fetchGlobalOptions}
        updateGlobalOptions={updateGlobalOptions}
        addUri={addUriWithCategory}
        addTorrent={addTorrent}
        selectedGid={selectedGid}
        taskPeers={taskPeers}
        taskServers={taskServers}
        speedHistory={speedHistory}
        setSelectedGid={setSelectedGid}
        theme={theme}
        toggleTheme={toggleTheme}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        modalInitialUris={modalInitialUris}
        modalInitialMode={modalInitialMode}
        setModalInitialUris={setModalInitialUris}
        setModalInitialMode={setModalInitialMode}
        connect={connect}
        reconnectCountdown={reconnectCountdown}
        changeTaskOption={changeTaskOption}
        getTaskOptions={getTaskOptions}
        events={events}
        acknowledgeEvent={acknowledgeEvent}
        deleteHistoryTask={deleteHistoryTask}
        clearHistoryTasks={clearHistoryTasks}
      />
    </SmartDownloadProvider>
  );
}

interface AppContentProps {
  activeTab: 'dashboard' | 'downloads' | 'search' | 'settings';
  setActiveTab: React.Dispatch<React.SetStateAction<'dashboard' | 'downloads' | 'search' | 'settings'>>;
  showAddModal: boolean;
  setShowAddModal: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  getStatusBadge: () => React.ReactNode;
  globalStat: Aria2GlobalStat;
  activeTasks: Aria2Task[];
  waitingTasks: Aria2Task[];
  stoppedTasks: Aria2Task[];
  allActiveAndWaiting: Aria2Task[];
  status: 'connecting' | 'connected' | 'disconnected';
  globalOptions: Record<string, string>;
  pauseTask: (gid: string) => void;
  resumeTask: (gid: string) => void;
  removeTask: (gid: string, status: string) => void;
  clearStopped: () => void;
  fetchGlobalOptions: () => void;
  updateGlobalOptions: (options: Record<string, string>) => void;
  addUri: (uri: string) => void;
  addTorrent: (base64: string) => void;
  selectedGid: string | null;
  taskPeers: any[];
  taskServers: any[];
  speedHistory: { down: number[]; up: number[] };
  setSelectedGid: React.Dispatch<React.SetStateAction<string | null>>;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  modalInitialUris: string;
  modalInitialMode: 'link' | 'torrent';
  setModalInitialUris: React.Dispatch<React.SetStateAction<string>>;
  setModalInitialMode: React.Dispatch<React.SetStateAction<'link' | 'torrent'>>;
  
  connect: () => void;
  reconnectCountdown: number | null;
  changeTaskOption: (gid: string, options: Record<string, string>) => Promise<any>;
  getTaskOptions: (gid: string) => Promise<any>;
  events: any[];
  acknowledgeEvent: (id: string) => void;
  deleteHistoryTask: (gid: string) => Promise<any>;
  clearHistoryTasks: () => Promise<any>;
}

function playNotificationBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    
    // Clean fade out to avoid clicks
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.error('Failed to play notification beep:', e);
  }
}


function AppContent({
  activeTab, setActiveTab, showAddModal, setShowAddModal,
  searchQuery, setSearchQuery,
  getStatusBadge, globalStat,
  activeTasks, waitingTasks, stoppedTasks, allActiveAndWaiting,
  status, globalOptions, pauseTask, resumeTask, removeTask, clearStopped,
  fetchGlobalOptions, updateGlobalOptions, addUri, addTorrent,
  selectedGid, taskPeers, taskServers, speedHistory, setSelectedGid,
  theme, toggleTheme, selectedCategory, setSelectedCategory,
  modalInitialUris, modalInitialMode, setModalInitialUris, setModalInitialMode,
  connect, reconnectCountdown, changeTaskOption, getTaskOptions,
  events, acknowledgeEvent,
  deleteHistoryTask, clearHistoryTasks,
}: AppContentProps) {
  const { isDragging } = useSmartDownload();
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showSambaPass, setShowSambaPass] = useState(false);

  const activeCount = useMemo(() => {
    return allActiveAndWaiting.filter((t: Aria2Task) => t.status === 'active' && !isTorrentCompleted(t) && !isMetadataTask(t)).length;
  }, [allActiveAndWaiting]);

  const { showToast } = useToast();
  const { getApiUrl } = useApiUrl();

  const retryCountsRef = useRef<Map<string, number>>(new Map());

  // Disk Space State
  interface DiskSpaceInfo {
    total: number;
    used: number;
    free: number;
  }
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);

  // Fetch disk space from `/api/disk`
  const fetchDiskSpace = useCallback(async () => {
    try {
      const url = getApiUrl('disk');
      const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
      const headers: Record<string, string> = {};
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setDiskSpace(data);
      }
    } catch (e) {
      console.error('Failed to fetch disk space:', e);
    }
  }, [getApiUrl]);

  useEffect(() => {
    fetchDiskSpace();
    const interval = setInterval(fetchDiskSpace, 15000);
    return () => clearInterval(interval);
  }, [fetchDiskSpace]);

  // Task Removal States
  const [taskToRemove, setTaskToRemove] = useState<Aria2Task | null>(null);
  const [deleteFilesOnDisk, setDeleteFilesOnDisk] = useState(false);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);

  // Bulk Clear States
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [deleteClearAllFiles, setDeleteClearAllFiles] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

  // Helper to resolve paths to delete for a task
  const getPathsToDelete = useCallback((task: Aria2Task): string[] => {
    if (!task.files || task.files.length === 0) return [];
    
    const paths = task.files
      .map(f => {
        let p = f.path;
        if (!p) return '';
        // If it's a relative path (doesn't start with /downloads/ or /), prepend /downloads/
        if (!p.startsWith('/downloads/') && !p.startsWith('/')) {
          p = `/downloads/${p}`;
        }
        return p;
      })
      .filter(p => p && p.startsWith('/downloads/'));
      
    if (paths.length === 0) return [];
    
    const itemsToDelete = new Set<string>();
    
    for (const path of paths) {
      const relative = path.substring('/downloads/'.length);
      const firstPart = relative.split(/[/\\]/)[0];
      if (firstPart) {
        const topLevelPath = `/downloads/${firstPart}`;
        itemsToDelete.add(topLevelPath);
        itemsToDelete.add(`${topLevelPath}.aria2`);
      }
    }
    
    return Array.from(itemsToDelete);
  }, []);

  const handleInitiateRemove = (task: Aria2Task) => {
    setTaskToRemove(task);
    setDeleteFilesOnDisk(false);
  };

  const handleConfirmRemove = async () => {
    if (!taskToRemove) return;
    
    setIsDeletingFiles(true);
    try {
      const paths = deleteFilesOnDisk
        ? getPathsToDelete(taskToRemove)
        : getPathsToDelete(taskToRemove).filter(p => p.endsWith('.aria2'));
        
      if (paths.length > 0) {
        const url = getApiUrl('delete-files');
        const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (secret) {
          headers['Authorization'] = `Bearer ${secret}`;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ files: paths })
        });
        
        if (!res.ok) {
          console.error('Failed to delete files on disk');
        } else {
          const data = await res.json();
          if (data.errors && data.errors.length > 0) {
            showToast({
              type: 'warning',
              title: 'Partial file deletion',
              message: data.errors.join(', ')
            });
          } else if (deleteFilesOnDisk) {
            showToast({
              type: 'success',
              title: 'Files deleted',
              message: 'Successfully deleted downloaded files from disk.'
            });
          }
        }
      }
    } catch (e) {
      console.error('Error during file deletion:', e);
      showToast({
        type: 'error',
        title: 'Error deleting files',
        message: 'An error occurred while trying to delete files from disk.'
      });
    } finally {
      removeTask(taskToRemove.gid, taskToRemove.status);
      if (taskToRemove.status === 'complete' || taskToRemove.status === 'error' || taskToRemove.status === 'removed') {
        await deleteHistoryTask(taskToRemove.gid);
      }
      setTaskToRemove(null);
      setIsDeletingFiles(false);
      setTimeout(fetchDiskSpace, 1000);
    }
  };

  const handleConfirmClearAll = async () => {
    setIsClearingAll(true);
    try {
      const allPaths: string[] = [];
      for (const task of stoppedTasks) {
        const paths = getPathsToDelete(task);
        if (deleteClearAllFiles) {
          allPaths.push(...paths);
        } else {
          allPaths.push(...paths.filter(p => p.endsWith('.aria2')));
        }
      }
      
      if (allPaths.length > 0) {
        const url = getApiUrl('delete-files');
        const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (secret) {
          headers['Authorization'] = `Bearer ${secret}`;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ files: allPaths })
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.errors && data.errors.length > 0) {
            showToast({
              type: 'warning',
              title: 'Partial file deletion',
              message: 'Some files could not be deleted.'
            });
          } else if (deleteClearAllFiles) {
            showToast({
              type: 'success',
              title: 'Files deleted',
              message: 'Successfully deleted files for all stopped tasks.'
            });
          }
        }
      }
    } catch (e) {
      console.error('Error clearing all files:', e);
    } finally {
      clearStopped();
      await clearHistoryTasks();
      setShowClearAllConfirm(false);
      setIsClearingAll(false);
      setTimeout(fetchDiskSpace, 1000);
    }
  };

  // Retry logic
  const retryTask = useCallback(async (task: Aria2Task) => {
    const url = task.infoHash 
      ? `magnet:?xt=urn:btih:${task.infoHash}` 
      : (task.files?.[0]?.uris?.[0]?.uri || null);
      
    if (url) {
      const aria2Paths = getPathsToDelete(task).filter(p => p.endsWith('.aria2'));
      if (aria2Paths.length > 0) {
        try {
          const apiUrl = getApiUrl('delete-files');
          const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (secret) {
            headers['Authorization'] = `Bearer ${secret}`;
          }
          await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ files: aria2Paths })
          });
        } catch (e) {
          console.error('Failed to clean up .aria2 control file before retry:', e);
        }
      }

      addUri(url);
      removeTask(task.gid, task.status);
      if (task.status === 'complete' || task.status === 'error' || task.status === 'removed') {
        await deleteHistoryTask(task.gid);
      }
      showToast({
        type: 'success',
        title: 'Retrying Download',
        message: `Started retrying task: ${getTaskName(task)}`
      });
      setTimeout(fetchDiskSpace, 1000);
    } else {
      showToast({
        type: 'error',
        title: 'Retry Failed',
        message: 'Could not retrieve original download link for this task.'
      });
    }
  }, [addUri, removeTask, showToast, getPathsToDelete, fetchDiskSpace, getApiUrl]);

  // Process aria2 events inside AppContent to access retryTask and play notification sound
  useEffect(() => {
    if (events.length === 0) return;

    for (const event of events) {
      if (event.type === 'complete') {
        const completedTask = [...activeTasks, ...waitingTasks, ...stoppedTasks].find(t => t.gid === event.gid);
        const taskName = completedTask ? getTaskName(completedTask) : event.gid;

        showToast({
          type: 'success',
          title: 'Download Complete',
          message: `Task "${taskName}" finished successfully`,
        });

        const soundEnabled = localStorage.getItem('ariazero_sound_enabled') !== 'false';
        if (soundEnabled) {
          playNotificationBeep();
        }

        if (Notification.permission === 'granted') {
          new Notification('AriaZero — Download Complete', {
            body: `Task "${taskName}" finished`,
            icon: '/favicon.ico',
          });
        }
      } else if (event.type === 'error') {
        const autoRetryEnabled = localStorage.getItem('ariazero_auto_retry_enabled') !== 'false';
        const maxRetryCount = Number(localStorage.getItem('ariazero_auto_retry_count') || '3');
        const retryDelaySec = Number(localStorage.getItem('ariazero_auto_retry_delay') || '5');

        const currentRetryCount = retryCountsRef.current.get(event.gid) || 0;

        if (autoRetryEnabled && currentRetryCount < maxRetryCount) {
          const failedTask = [...activeTasks, ...waitingTasks, ...stoppedTasks].find(t => t.gid === event.gid);
          if (failedTask) {
            const nextRetry = currentRetryCount + 1;
            retryCountsRef.current.set(event.gid, nextRetry);
            
            showToast({
              type: 'info',
              title: `Auto-Retrying Download`,
              message: `Task "${getTaskName(failedTask)}" failed. Retrying ${nextRetry}/${maxRetryCount} in ${retryDelaySec}s...`,
              duration: retryDelaySec * 1000
            });

            setTimeout(() => {
              retryTask(failedTask);
            }, retryDelaySec * 1000);
          } else {
            showToast({
              type: 'error',
              title: 'Download Error',
              message: `Task ${event.gid} encountered an error`,
            });
          }
        } else {
          const failedTask = [...activeTasks, ...waitingTasks, ...stoppedTasks].find(t => t.gid === event.gid);
          const taskName = failedTask ? getTaskName(failedTask) : event.gid;
          showToast({
            type: 'error',
            title: 'Download Error',
            message: `Task "${taskName}" encountered an error`,
          });
        }
      }
      acknowledgeEvent(event.id);
    }
  }, [events, acknowledgeEvent, showToast, activeTasks, waitingTasks, stoppedTasks, retryTask]);

  // Derived state stats calculations memoized
  const allTasks = useMemo(() => {
    return [...allActiveAndWaiting, ...stoppedTasks].filter((t: Aria2Task) => !isMetadataTask(t));
  }, [allActiveAndWaiting, stoppedTasks]);

  const categoryCounts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let torrent = 0;
    let video = 0;
    let audio = 0;
    let doc = 0;
    let software = 0;

    allActiveAndWaiting.forEach((t: Aria2Task) => {
      if (isMetadataTask(t)) return;
      if (t.status === 'active' && !isTorrentCompleted(t)) {
        active++;
      }
      if (isTorrentCompleted(t)) {
        completed++;
      }
    });

    stoppedTasks.forEach((t: Aria2Task) => {
      if (isMetadataTask(t)) return;
      if (t.status === 'complete') {
        completed++;
      }
    });

    allTasks.forEach((t: Aria2Task) => {
      if (isTorrent(t)) torrent++;
      const ext = getFileExtension(getTaskName(t));
      if (isVideo(ext)) video++;
      else if (isAudio(ext)) audio++;
      else if (isDoc(ext)) doc++;
      else if (isSoftware(ext)) software++;
    });

    return { active, completed, torrent, video, audio, doc, software };
  }, [allActiveAndWaiting, stoppedTasks, allTasks]);

  const categories = useMemo(() => [
    { id: 'all', label: 'All Tasks', icon: Folder, count: allTasks.length },
    { id: 'active', label: 'Active', icon: Activity, count: categoryCounts.active },
    { id: 'completed', label: 'Completed', icon: CheckCircle, count: categoryCounts.completed },
    { id: 'torrents', label: 'Torrents', icon: Share2, count: categoryCounts.torrent },
    { id: 'video', label: 'Video', icon: Film, count: categoryCounts.video },
    { id: 'audio', label: 'Audio', icon: Music, count: categoryCounts.audio },
    { id: 'documents', label: 'Documents', icon: FileText, count: categoryCounts.doc },
    { id: 'software', label: 'Software / Zip', icon: Box, count: categoryCounts.software },
  ], [allTasks.length, categoryCounts]);


  const selectedTask = useMemo(() => {
    return [...allActiveAndWaiting, ...stoppedTasks].find(t => t.gid === selectedGid);
  }, [allActiveAndWaiting, stoppedTasks, selectedGid]);

  const handleAddSubmit = async (mode: 'link' | 'torrent', uris: string, torrentFile: { name: string; base64: string } | null) => {
    if (mode === 'link') {
      if (!uris.trim()) return;
      const parsedUris = uris.split('\n').map((u: string) => u.trim()).filter((u: string) => u);
      for (const uri of parsedUris) {
        try {
          await addUri(uri);
          showToast({
            type: 'success',
            title: 'Download Started',
            message: 'Task added to queue successfully.'
          });
        } catch (err: any) {
          console.error('Failed to add URI:', err);
          const errMsg = err?.message || err || 'Failed to add task to Aria2.';
          showToast({
            type: 'error',
            title: 'Failed to Add Task',
            message: `Error: ${errMsg}`
          });
        }
      }
    } else {
      if (!torrentFile) return;
      try {
        await addTorrent(torrentFile.base64);
        showToast({
          type: 'success',
          title: 'Torrent Started',
          message: 'Torrent task added to queue successfully.'
        });
      } catch (err: any) {
        console.error('Failed to add torrent:', err);
        const errMsg = err?.message || err || 'Failed to add torrent to Aria2.';
        showToast({
          type: 'error',
          title: 'Failed to Add Torrent',
          message: `Error: ${errMsg}`
        });
      }
    }
  };

  const renderSidebarContent = (isMobile = false) => {
    return (
      <>
        <div className="p-5 border-b border-border-main flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="bg-cyan-500/15 p-1.5 rounded-lg border border-cyan-500/30">
              <Activity className="w-5 h-5 text-cyan-400" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              AriaZero
            </span>
          </div>
          {isMobile && (
            <button 
              onClick={() => setShowMobileSidebar(false)}
              className="text-text-dim hover:text-text-main p-1 rounded-lg transition-colors md:hidden cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        
        {/* Navigation Tabs */}
        <nav className="px-4 py-4 space-y-1 flex-1 overflow-y-auto">
          <button 
            onClick={() => {
              setActiveTab('dashboard');
              if (isMobile) setShowMobileSidebar(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'dashboard' 
                ? 'bg-cyan-500/8 text-cyan-400 border-l-2 border-cyan-400' 
                : 'text-text-dim hover:bg-page-bg/40 hover:text-text-main border-l-2 border-transparent'
            }`}
          >
            <Activity className="w-4 h-4" />
            Dashboard
          </button>
          
          <button 
            onClick={() => {
              setActiveTab('downloads');
              if (isMobile) setShowMobileSidebar(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'downloads' 
                ? 'bg-cyan-500/8 text-cyan-400 border-l-2 border-cyan-400' 
                : 'text-text-dim hover:bg-page-bg/40 hover:text-text-main border-l-2 border-transparent'
            }`}
          >
            <ArrowDown className="w-4 h-4" />
            Downloads
            {activeCount > 0 && (
              <span className="ml-auto bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 text-xs px-2 py-0.5 rounded-full">
                {activeCount}
              </span>
            )}
          </button>
          
          <button 
            onClick={() => {
              setActiveTab('search');
              if (isMobile) setShowMobileSidebar(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'search' 
                ? 'bg-cyan-500/8 text-cyan-400 border-l-2 border-cyan-400' 
                : 'text-text-dim hover:bg-page-bg/40 hover:text-text-main border-l-2 border-transparent'
            }`}
          >
            <Search className="w-4 h-4" />
            Search Torrents
          </button>
          
          <button 
            onClick={() => {
              setActiveTab('settings');
              if (isMobile) setShowMobileSidebar(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'settings' 
                ? 'bg-cyan-500/8 text-cyan-400 border-l-2 border-cyan-400' 
                : 'text-text-dim hover:bg-page-bg/40 hover:text-text-main border-l-2 border-transparent'
            }`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border-main bg-page-bg/30 shrink-0">
          {diskSpace && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-text-dim mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-cyan-400" />
                  Disk Storage
                </span>
                <span className="font-mono text-[10px] text-text-main font-semibold">
                  {formatBytes(diskSpace.free)} free
                </span>
              </div>
              <div className="bg-page-bg/40 border border-border-main/20 rounded-full h-1.5 overflow-hidden mb-1">
                <div 
                  style={{ width: `${Math.round((diskSpace.used / diskSpace.total) * 100)}%` }} 
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                ></div>
              </div>
              <div className="flex justify-between text-[9px] text-text-dim/80 font-mono">
                <span>Used: {formatBytes(diskSpace.used)}</span>
                <span>Total: {formatBytes(diskSpace.total)}</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-text-dim mb-2">
            <span>Samba Share</span>
            <span className="text-emerald-400 font-semibold">Active</span>
          </div>
          <div className="text-[11px] text-text-dim font-mono break-all bg-page-bg/60 p-2 rounded border border-border-main space-y-1">
            <div>\\{window.location.hostname}\downloads</div>
            <div className="flex items-center justify-between text-[9px] text-text-dim/80 mt-1">
              <span>User: {(window as any).AriaZeroServerConfig?.smbUser || 'admin'}</span>
              <span className="flex items-center gap-1">
                <span>Pass: {showSambaPass ? ((window as any).AriaZeroServerConfig?.smbPassword || '123456') : '••••••'}</span>
                <button
                  type="button"
                  onClick={() => setShowSambaPass(!showSambaPass)}
                  className="text-text-dim hover:text-text-main focus:outline-none cursor-pointer"
                  title={showSambaPass ? "Hide Password" : "Show Password"}
                >
                  {showSambaPass ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </span>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className={`flex h-screen overflow-hidden font-sans relative ${theme === 'light' ? 'theme-light bg-page-bg text-text-main' : 'bg-page-bg text-text-main'}`}>

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-[100] bg-page-bg/85 backdrop-blur-md flex items-center justify-center">
          <div className="border-2 border-dashed border-cyan-500/50 rounded-2xl p-16 flex flex-col items-center gap-4 animate-pulse">
            <Link className="w-12 h-12 text-cyan-400" />
            <span className="text-lg font-semibold text-cyan-400">Drop links or .torrent files here to download</span>
            <span className="text-xs text-text-dim">Release to add download task</span>
          </div>
        </div>
      )}
      
      {/* Mobile Sidebar backdrop */}
      {showMobileSidebar && (
        <div 
          className="fixed inset-0 bg-slate-950/60 z-[60] md:hidden backdrop-blur-xs transition-opacity duration-300"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}
      
      {/* Mobile Sidebar Drawer */}
      <aside 
        className={`fixed inset-y-0 left-0 w-64 bg-sidebar-bg border-r border-border-main z-[70] flex flex-col md:hidden transition-transform duration-300 transform ${
          showMobileSidebar ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderSidebarContent(true)}
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-sidebar-bg border-r border-border-main flex-col shrink-0">
        {renderSidebarContent(false)}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative bg-page-bg">
        
        {status === 'disconnected' && (
          <div className="bg-gradient-to-r from-red-500/20 to-orange-500/20 border-b border-red-500/30 px-4 py-2.5 flex items-center justify-between text-xs text-red-200 shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 animate-pulse" />
              <span>
                Mất kết nối với server. Tự động kết nối lại sau {reconnectCountdown !== null ? reconnectCountdown : '...'} giây...
              </span>
            </div>
            <button
              onClick={() => connect()}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-100 px-3 py-1 rounded transition-colors text-[10px] font-medium cursor-pointer"
            >
              Kết nối lại ngay
            </button>
          </div>
        )}

        {/* Top Header */}
        <header className="h-16 bg-sidebar-bg border-b border-border-main flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => setShowMobileSidebar(true)}
              className="p-1.5 rounded-lg bg-input-bg border border-border-main text-text-dim hover:text-text-main md:hidden transition-colors cursor-pointer"
              title="Menu"
            >
              <Menu className="w-4.5 h-4.5" />
            </button>
            <h1 className="text-md md:text-lg font-semibold text-text-main capitalize">
              {activeTab === 'search' ? 'Search Torrents' : activeTab}
            </h1>
            <div className="hidden sm:block">
              {getStatusBadge()}
            </div>
            {diskSpace && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] bg-slate-800/40 border border-slate-700/30 text-slate-300 px-2.5 py-1 rounded-full font-mono font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span>{formatBytes(diskSpace.free)} / {formatBytes(diskSpace.total)} free</span>
              </span>
            )}
            {selectedCategory !== 'all' && (
              <span className="hidden sm:inline-block text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-medium capitalize">
                {selectedCategory}
              </span>
            )}
          </div>
          
          {/* Action Buttons, Theme Toggle, & Search */}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="relative w-28 sm:w-48 md:w-64">
              <Search className="w-3.5 h-3.5 text-text-dim absolute left-2.5 top-2.5" />
              <input 
                type="text" 
                placeholder="Search..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-input-bg border border-border-main rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-text-main placeholder-text-dim/60 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            {/* Theme Toggle */}
            <button 
              onClick={toggleTheme}
              className="p-1.5 md:p-2 rounded-lg bg-input-bg border border-border-main text-text-dim hover:text-text-main transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400 animate-pulse" /> : <Moon className="w-3.5 h-3.5 text-indigo-500" />}
            </button>
            
            <button 
              onClick={() => {
                setModalInitialUris('');
                setModalInitialMode('link');
                setShowAddModal(true);
              }}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-medium text-xs px-2.5 py-1.5 sm:px-3.5 sm:py-1.5 rounded-lg flex items-center gap-1.5 shadow-md shadow-cyan-500/10 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Download</span>
            </button>
          </div>
        </header>

        {/* Page Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 md:space-y-8">
          
          {activeTab === 'dashboard' && (
            <DashboardPage
              activeTasks={activeTasks}
              waitingTasks={waitingTasks}
              stoppedTasks={stoppedTasks}
              speedHistory={speedHistory}
            />
          )}

          {activeTab === 'downloads' && (
            <DownloadsPage
              activeTasks={activeTasks}
              waitingTasks={waitingTasks}
              stoppedTasks={stoppedTasks}
              searchQuery={searchQuery}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              categories={categories}
              pauseTask={pauseTask}
              resumeTask={resumeTask}
              handleInitiateRemove={handleInitiateRemove}
              setSelectedGid={setSelectedGid}
              selectedGid={selectedGid}
              retryTask={retryTask}
              setShowClearAllConfirm={setShowClearAllConfirm}
              setDeleteClearAllFiles={setDeleteClearAllFiles}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPanel
              globalOptions={globalOptions}
              updateGlobalOptions={updateGlobalOptions}
              fetchGlobalOptions={fetchGlobalOptions}
              connectionStatus={status}
            />
          )}

          {activeTab === 'search' && (
            <SearchTorrentsPage
              addUri={addUri}
              showToast={showToast}
            />
          )}

        </div>

        {/* Global speed indicator at bottom */}
        <footer className="h-12 bg-sidebar-bg border-t border-border-main flex items-center justify-between px-4 md:px-8 text-xs text-text-dim shrink-0 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-semibold text-text-main">
              AriaZero
              <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono font-bold">
                v1.2.0
              </span>
            </span>
            <span className="hidden lg:inline text-[10px] text-text-dim/60 font-mono">Real-time Graphs • Task details drawer • Bandwidth scheduler</span>
          </div>
          
          {/* Sparklines */}
          <div className="flex items-center gap-4 md:gap-6">
            <div className="flex items-center gap-1.5 md:gap-2">
              <ArrowDown className="w-3.5 h-3.5 text-cyan-400" />
              <span>Down: {formatSpeed(globalStat.downloadSpeed)}</span>
              <div className="hidden sm:block ml-1 shrink-0 opacity-80 border border-border-main/40 rounded p-0.5 bg-page-bg/40">
                <Sparkline data={speedHistory?.down || []} color="#22d3ee" />
              </div>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
              <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Up: {formatSpeed(globalStat.uploadSpeed)}</span>
              <div className="hidden sm:block ml-1 shrink-0 opacity-80 border border-border-main/40 rounded p-0.5 bg-page-bg/40">
                <Sparkline data={speedHistory?.up || []} color="#34d399" />
              </div>
            </div>
          </div>
        </footer>

        {/* Sliding Task Details Drawer */}
        <TaskDetailsDrawer
          selectedTask={selectedTask}
          onClose={() => setSelectedGid(null)}
          taskPeers={taskPeers}
          taskServers={taskServers}
          retryTask={retryTask}
          changeTaskOption={changeTaskOption}
          getTaskOptions={getTaskOptions}
        />
      </main>

      {/* Reusable modals */}
      <ConfirmModal
        isOpen={taskToRemove !== null}
        onClose={() => setTaskToRemove(null)}
        onConfirm={handleConfirmRemove}
        title="Remove Download"
        message="Are you sure you want to remove this download task from the list?"
        taskName={taskToRemove ? getTaskName(taskToRemove) : ''}
        showCheckbox={taskToRemove ? getPathsToDelete(taskToRemove).length > 0 : false}
        checkboxLabel="Also delete downloaded files from disk"
        checkboxSublabel="Permanently removes files inside /downloads/"
        checkboxChecked={deleteFilesOnDisk}
        onCheckboxChange={setDeleteFilesOnDisk}
        warningMessage="Warning: This will permanently delete the downloaded files on your server's storage. This action cannot be undone."
        confirmText="Confirm Remove"
        loadingText="Deleting..."
        isLoading={isDeletingFiles}
      />

      <ConfirmModal
        isOpen={showClearAllConfirm}
        onClose={() => setShowClearAllConfirm(false)}
        onConfirm={handleConfirmClearAll}
        title="Clear History"
        message="Are you sure you want to clear all stopped and completed tasks from history?"
        showCheckbox={true}
        checkboxLabel="Also delete files for these tasks from disk"
        checkboxSublabel="Permanently removes files inside /downloads/"
        checkboxChecked={deleteClearAllFiles}
        onCheckboxChange={setDeleteClearAllFiles}
        warningMessage="Warning: This will permanently delete files for ALL history tasks. This action cannot be undone."
        confirmText="Confirm Clear"
        loadingText="Deleting..."
        isLoading={isClearingAll}
      />

      <AddDownloadModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddSubmit}
        initialUris={modalInitialUris}
        initialMode={modalInitialMode}
      />

    </div>
  );
}

export default App;
