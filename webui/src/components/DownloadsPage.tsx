import { useMemo, useState, useEffect, useCallback, memo } from 'react';
import { ArrowUp, Pause, Play, Trash2, AlertCircle, Check, Clock, RefreshCw, HardDrive } from 'lucide-react';
import { formatBytes, formatSpeed } from '../useAria2';
import type { Aria2Task } from '../useAria2';
import { 
  isTorrentCompleted, 
  isTaskSeeding, 
  getTaskName, 
  isMetadataTask, 
  filterTaskByCategory 
} from '../utils/taskUtils';
import TaskCard from './TaskCard';
import ContextMenu from './ContextMenu';
import { useToast } from '../Toast';
import { useApiUrl } from '../hooks/useApiUrl';

interface DownloadsPageProps {
  activeTasks: Aria2Task[];
  waitingTasks: Aria2Task[];
  stoppedTasks: Aria2Task[];
  searchQuery: string;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  categories: { id: string; label: string; icon: any; count: number }[];
  pauseTask: (gid: string) => void;
  resumeTask: (gid: string) => void;
  handleInitiateRemove: (task: Aria2Task) => void;
  setSelectedGid: (gid: string | null) => void;
  selectedGid: string | null;
  retryTask: (task: Aria2Task) => void;
  setShowClearAllConfirm: (show: boolean) => void;
  setDeleteClearAllFiles: (del: boolean) => void;
}

interface GDriveQueueItem {
  id: number;
  url: string;
  filename: string | null;
  added_at: number;
  last_tried: number;
  attempts: number;
  status: string;
  error: string | null;
}

export default function DownloadsPage({
  activeTasks,
  waitingTasks,
  stoppedTasks,
  searchQuery,
  selectedCategory,
  categories,
  setSelectedCategory,
  pauseTask,
  resumeTask,
  handleInitiateRemove,
  setSelectedGid,
  selectedGid,
  retryTask,
  setShowClearAllConfirm,
  setDeleteClearAllFiles,
}: DownloadsPageProps) {
  const { showToast } = useToast();
  const { getApiUrl } = useApiUrl();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Aria2Task } | null>(null);
  const [gdriveQueue, setGdriveQueue] = useState<GDriveQueueItem[]>([]);

  const fetchGDriveQueue = useCallback(async () => {
    try {
      const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
      const headers: Record<string, string> = {};
      if (secret) headers['Authorization'] = `Bearer ${secret}`;
      const res = await fetch(getApiUrl('gdrive-queue'), { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setGdriveQueue(data);
        }
      }
    } catch {
      // ignore
    }
  }, [getApiUrl]);

  useEffect(() => {
    fetchGDriveQueue();
    const timer = setInterval(fetchGDriveQueue, 10000);
    return () => clearInterval(timer);
  }, [fetchGDriveQueue]);

  const handleRetryQueueItem = async (id: number) => {
    try {
      const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) headers['Authorization'] = `Bearer ${secret}`;
      const res = await fetch(getApiUrl('gdrive-queue/retry'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.downloadStarted) {
        showToast({ type: 'success', title: 'Thành công', message: 'Google đã mở Quota! File đã bắt đầu được tải về.' });
        fetchGDriveQueue();
      } else {
        showToast({ type: 'info', title: 'Thông báo', message: data.error || 'Google vẫn đang khóa Quota 24h đối với file này. Hệ thống sẽ tiếp tục thử lại tự động.' });
        fetchGDriveQueue();
      }
    } catch {
      showToast({ type: 'error', title: 'Lỗi', message: 'Không thể kết nối máy chủ' });
    }
  };

  const handleDeleteQueueItem = async (id: number) => {
    try {
      const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) headers['Authorization'] = `Bearer ${secret}`;
      await fetch(getApiUrl('gdrive-queue/delete'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ id })
      });
      showToast({ type: 'info', title: 'Đã xóa', message: 'Đã hủy theo dõi file khỏi hàng chờ.' });
      fetchGDriveQueue();
    } catch {
      showToast({ type: 'error', title: 'Lỗi', message: 'Không thể xóa' });
    }
  };

  const handleContextMenu = (e: React.MouseEvent, task: Aria2Task) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      task
    });
  };

  const lowercaseQuery = useMemo(() => searchQuery.toLowerCase().trim(), [searchQuery]);

  const allActiveAndWaiting = useMemo(() => [...activeTasks, ...waitingTasks], [activeTasks, waitingTasks]);

  const displayDownloads = useMemo(() => {
    if (!lowercaseQuery) return allActiveAndWaiting;
    return allActiveAndWaiting.filter(t => getTaskName(t).toLowerCase().includes(lowercaseQuery));
  }, [allActiveAndWaiting, lowercaseQuery]);

  const displayStopped = useMemo(() => {
    if (!lowercaseQuery) return stoppedTasks;
    return stoppedTasks.filter(t => getTaskName(t).toLowerCase().includes(lowercaseQuery));
  }, [stoppedTasks, lowercaseQuery]);

  const downloads = useMemo(() => {
    return displayDownloads.filter((t: Aria2Task) => !isTorrentCompleted(t));
  }, [displayDownloads]);

  const completedAndStopped = useMemo(() => {
    const downloadsTorrentComplete = displayDownloads.filter((t: Aria2Task) => isTorrentCompleted(t) && !isMetadataTask(t));
    const activeGids = new Set(downloadsTorrentComplete.map(t => t.gid));
    const stoppedClean = displayStopped.filter((t: Aria2Task) => !isMetadataTask(t) && !activeGids.has(t.gid));

    const combined = [...downloadsTorrentComplete, ...stoppedClean];
    const seenGids = new Set<string>();
    const unique: Aria2Task[] = [];
    for (const t of combined) {
      if (!seenGids.has(t.gid)) {
        seenGids.add(t.gid);
        unique.push(t);
      }
    }
    return unique;
  }, [displayStopped, displayDownloads]);

  const filteredDownloads = useMemo(() => {
    return downloads.filter(t => filterTaskByCategory(t, selectedCategory));
  }, [downloads, selectedCategory]);

  const filteredStopped = useMemo(() => {
    return completedAndStopped.filter(t => filterTaskByCategory(t, selectedCategory));
  }, [completedAndStopped, selectedCategory]);

  const filteredGdriveQueue = useMemo(() => {
    if (selectedCategory !== 'all' && selectedCategory !== 'active' && selectedCategory !== 'video') {
      return [];
    }
    if (!lowercaseQuery) return gdriveQueue;
    return gdriveQueue.filter(item => {
      const name = item.filename ? item.filename.toLowerCase() : '';
      const url = item.url ? item.url.toLowerCase() : '';
      return name.includes(lowercaseQuery) || url.includes(lowercaseQuery);
    });
  }, [gdriveQueue, selectedCategory, lowercaseQuery]);

  const cleanGdriveName = (name: string | null | undefined) => {
    if (!name) return 'Google Drive File';
    try {
      return decodeURIComponent(name).replace(/%3A/gi, ':');
    } catch {
      return name.replace(/%3A/gi, ':');
    }
  };

  const getPillCount = (cat: typeof categories[0]) => {
    if (cat.id === 'all' || cat.id === 'active') {
      return cat.count + gdriveQueue.length;
    }
    return cat.count;
  };

  return (
    <div className="space-y-8">
      {/* Category Pills Filters */}
      <div className="bg-card-bg border border-border-main rounded-xl p-4">
        <span className="text-[10px] text-text-dim uppercase tracking-wider font-bold block mb-3 px-1">Filter Categories</span>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            const count = getPillCount(cat);
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? cat.id === 'error'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-400 font-bold'
                      : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 font-bold'
                    : 'bg-page-bg/30 border-border-main text-text-dim hover:text-text-main hover:bg-page-bg/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${cat.id === 'error' && !isSelected ? 'text-rose-400/80' : ''}`} />
                <span>{cat.label}</span>
                {count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${
                    cat.id === 'error'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20'
                      : isSelected
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20'
                        : 'bg-border-main border border-border-main/20 text-text-dim'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Downloads (Includes GDrive Queue) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-text-dim">Active Downloads</h2>
            {(filteredDownloads.length > 0 || filteredGdriveQueue.length > 0) && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-mono font-semibold">
                {filteredDownloads.length + filteredGdriveQueue.length}
              </span>
            )}
            {filteredGdriveQueue.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium flex items-center gap-1">
                <Clock className="w-3 h-3 animate-pulse inline" />
                {filteredGdriveQueue.length} GDrive Queue
              </span>
            )}
          </div>
        </div>

        {filteredDownloads.length === 0 && filteredGdriveQueue.length === 0 ? (
          <div className="bg-card-bg border border-border-main border-dashed rounded-xl p-10 text-center text-text-dim text-xs">
            No matching active or waiting download tasks.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Google Drive Queue Items */}
            {filteredGdriveQueue.map((item) => (
              <div 
                key={`gdrive-${item.id}`} 
                className="bg-card-bg border border-amber-500/25 hover:border-amber-500/40 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md shadow-amber-500/5 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shrink-0">
                    <HardDrive className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Google Drive Queue
                      </span>
                      <span className="text-[10px] text-amber-400/90 font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3 animate-pulse inline" /> Chờ Google mở lại Quota 24h
                      </span>
                    </div>
                    <div className="font-semibold text-xs text-text-main truncate" title={cleanGdriveName(item.filename)}>
                      {cleanGdriveName(item.filename)}
                    </div>
                    <div className="text-[11px] text-text-dim flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-amber-400/90 font-medium">Tự động thử lại mỗi 30 phút</span>
                      <span>•</span>
                      <span>Đã thử: {item.attempts} lần</span>
                      {item.last_tried ? (
                        <>
                          <span>•</span>
                          <span>Lần thử cuối: {new Date(item.last_tried * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border-main/40 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => handleRetryQueueItem(item.id)}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs hover:bg-cyan-500/20 flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Thử giải mã và tải ngay lập tức"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử lại ngay</span>
                  </button>
                  <button
                    onClick={() => handleDeleteQueueItem(item.id)}
                    className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition-colors cursor-pointer"
                    title="Xóa khỏi hàng chờ"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {/* Standard Active Downloads */}
            {filteredDownloads.map((task: Aria2Task) => (
              <TaskCard 
                key={task.gid} 
                task={task} 
                onPause={pauseTask} 
                onResume={resumeTask} 
                onRemove={handleInitiateRemove}
                onSelect={setSelectedGid}
                isSelected={selectedGid === task.gid}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Completions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border-main pb-2">
          <h2 className="text-sm font-semibold tracking-wider uppercase text-text-dim">Recent Completions</h2>
          {filteredStopped.length > 0 && (
            <button 
              onClick={() => {
                setShowClearAllConfirm(true);
                setDeleteClearAllFiles(false);
              }}
              className="text-xs text-text-dim hover:text-text-main flex items-center gap-1 transition-colors cursor-pointer"
            >
              Clear stopped tasks
            </button>
          )}
        </div>
        {filteredStopped.length === 0 ? (
          <div className="bg-card-bg border border-border-main border-dashed rounded-xl p-10 text-center text-text-dim text-xs">
            No matching completed or stopped tasks in history.
          </div>
        ) : (
          <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[550px] md:min-w-0">
                <thead>
                  <tr className="border-b border-border-main bg-page-bg/40 text-text-dim text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-3 px-5">File Name</th>
                    <th className="py-3 px-5 w-32">File Size</th>
                    <th className="py-3 px-5 w-32">Status</th>
                    <th className="py-3 px-5 w-24 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStopped.map((task: Aria2Task) => {
                    const isError = task.status === 'error';
                    const isSeeding = isTaskSeeding(task);
                    return (
                      <tr 
                        key={task.gid} 
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          setSelectedGid(task.gid);
                        }}
                        onContextMenu={(e) => handleContextMenu(e, task)}
                        className={`border-b border-border-main hover:bg-page-bg/25 text-xs text-text-main cursor-pointer transition-colors ${
                          selectedGid === task.gid ? 'bg-cyan-500/5' : ''
                        }`}
                      >
                        <td className="py-3 px-5 font-medium max-w-md truncate" title={getTaskName(task)}>
                          {getTaskName(task)}
                        </td>
                        <td className="py-3 px-5 text-text-dim">{formatBytes(task.totalLength)}</td>
                        <td className="py-3 px-5 relative group/status">
                          {isError ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-rose-400 flex items-center gap-1.5 font-medium cursor-help">
                                <AlertCircle className="w-3.5 h-3.5" />
                                Error
                              </span>
                              <button 
                                onClick={() => retryTask(task)}
                                className="px-1.5 py-0.5 text-[9px] bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 rounded-md hover:bg-cyan-500 hover:text-white transition-all cursor-pointer font-medium"
                                title="Retry download"
                              >
                                Retry
                              </button>
                              
                              {/* Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/status:block z-50 bg-slate-900 border border-slate-700 text-slate-100 text-[10px] p-2.5 rounded-lg shadow-xl max-w-xs w-64 pointer-events-none break-words font-mono text-left leading-relaxed">
                                <div className="text-rose-400 font-semibold mb-1">Aria2 Error (Code {task.errorCode || 'Unknown'}):</div>
                                <div>{task.errorMessage || 'No detailed error message available.'}</div>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                              </div>
                            </div>
                          ) : isSeeding ? (
                            <span className="text-emerald-400 flex items-center gap-1.5 font-medium animate-pulse">
                              <ArrowUp className="w-3.5 h-3.5" />
                              Seeding ({formatSpeed(task.uploadSpeed)})
                            </span>
                          ) : isTorrentCompleted(task) && (task.status === 'paused' || task.status === 'waiting') ? (
                            <span className="text-amber-400 flex items-center gap-1.5 font-medium">
                              <Pause className="w-3.5 h-3.5" />
                              Seeding Paused
                            </span>
                          ) : (
                            <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
                              <Check className="w-3.5 h-3.5" />
                              Completed
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-right flex items-center justify-end gap-1.5">
                          {isTorrentCompleted(task) && task.status !== 'complete' && (
                            task.status === 'active' ? (
                              <button 
                                onClick={() => pauseTask(task.gid)}
                                className="text-text-dim hover:text-cyan-400 p-1.5 rounded transition-colors cursor-pointer"
                                title="Pause Seeding"
                                aria-label="Pause Seeding"
                              >
                                <Pause className="w-4 h-4" />
                              </button>
                            ) : (
                              <button 
                                onClick={() => resumeTask(task.gid)}
                                className="text-text-dim hover:text-emerald-400 p-1.5 rounded transition-colors cursor-pointer"
                                title="Resume Seeding"
                                aria-label="Resume Seeding"
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )
                          )}
                          <button 
                            onClick={() => handleInitiateRemove(task)}
                            className="text-text-dim hover:text-rose-400 p-1.5 rounded transition-colors cursor-pointer"
                            title="Delete task from history"
                            aria-label="Delete task from history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={contextMenu.task}
          onClose={() => setContextMenu(null)}
          onPause={pauseTask}
          onResume={resumeTask}
          onRemove={handleInitiateRemove}
          onSelect={setSelectedGid}
          showToast={showToast}
        />
      )}
    </div>
  );
}

export const DownloadsPageMemo = memo(DownloadsPage);
