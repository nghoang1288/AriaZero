import { useMemo, useState, memo } from 'react';
import { ArrowUp, Pause, Play, Trash2, AlertCircle, Check } from 'lucide-react';
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Aria2Task } | null>(null);

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
    return displayDownloads.filter((t: Aria2Task) => !isTorrentCompleted(t) && !isMetadataTask(t));
  }, [displayDownloads]);

  const completedAndStopped = useMemo(() => {
    const stoppedClean = displayStopped.filter((t: Aria2Task) => !isMetadataTask(t));
    const downloadsTorrentComplete = displayDownloads.filter((t: Aria2Task) => isTorrentCompleted(t) && !isMetadataTask(t));
    return [...stoppedClean, ...downloadsTorrentComplete];
  }, [displayStopped, displayDownloads]);

  const filteredDownloads = useMemo(() => {
    return downloads.filter(t => filterTaskByCategory(t, selectedCategory));
  }, [downloads, selectedCategory]);

  const filteredStopped = useMemo(() => {
    return completedAndStopped.filter(t => filterTaskByCategory(t, selectedCategory));
  }, [completedAndStopped, selectedCategory]);

  return (
    <div className="space-y-8">
      {/* Category Pills Filters */}
      <div className="bg-card-bg border border-border-main rounded-xl p-4">
        <span className="text-[10px] text-text-dim uppercase tracking-wider font-bold block mb-3 px-1">Filter Categories</span>
        <div className="flex flex-wrap gap-2">
          {categories.map(cat => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
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
                {cat.count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${
                    cat.id === 'error'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20'
                      : isSelected
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20'
                        : 'bg-border-main border border-border-main/20 text-text-dim'
                  }`}>
                    {cat.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Downloads */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wider uppercase text-text-dim">Active Downloads</h2>
        </div>
        {filteredDownloads.length === 0 ? (
          <div className="bg-card-bg border border-border-main border-dashed rounded-xl p-10 text-center text-text-dim text-xs">
            No matching active or waiting download tasks.
          </div>
        ) : (
          <div className="space-y-3">
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
