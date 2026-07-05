import { memo } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import { formatSpeed, formatETA, formatBytes } from '../useAria2';
import type { Aria2Task } from '../useAria2';
import { getTaskName } from '../utils/taskUtils';

interface TaskCardProps {
  task: Aria2Task;
  onPause: (gid: string) => void;
  onResume: (gid: string) => void;
  onRemove: (task: Aria2Task) => void;
  onSelect: (gid: string) => void;
  isSelected: boolean;
  onContextMenu?: (e: React.MouseEvent, task: Aria2Task) => void;
}

const TaskCard = memo(function TaskCard({
  task,
  onPause,
  onResume,
  onRemove,
  onSelect,
  isSelected,
  onContextMenu
}: TaskCardProps) {
  const isActive = task.status === 'active';
  const isPaused = task.status === 'paused' || task.status === 'waiting';
  const total = Number(task.totalLength);
  const completed = Number(task.completedLength);
  const progressPercent = total > 0 ? Math.min(Math.round((completed / total) * 100), 100) : 0;
  
  const speed = formatSpeed(task.downloadSpeed);
  const eta = formatETA(task.completedLength, task.totalLength, task.downloadSpeed);

  return (
    <div 
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onSelect(task.gid);
      }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, task);
        }
      }}
      className={`border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all cursor-pointer ${
        isSelected 
          ? 'bg-card-bg border-cyan-500 shadow-md shadow-cyan-500/10 ring-1 ring-cyan-500/30' 
          : 'bg-card-bg border-border-main hover:border-cyan-500/40 text-text-main'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-semibold text-xs text-text-main truncate block max-w-[70vw] sm:max-w-lg" title={getTaskName(task)}>
            {getTaskName(task)}
          </span>
          <span className="text-[10px] text-text-dim font-mono">
            {formatBytes(task.totalLength)}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-page-bg/40 border border-border-main/20 rounded-full h-1.5 overflow-hidden">
            <div 
              style={{ width: `${progressPercent}%` }} 
              className={`h-full rounded-full transition-all duration-300 ${
                isActive ? 'bg-gradient-to-r from-cyan-500 to-blue-500' : 'bg-slate-700'
              }`}
            ></div>
          </div>
          <span className="text-[10px] font-mono text-text-dim w-8 text-right">{progressPercent}%</span>
        </div>
      </div>

      {/* Speed & ETA */}
      <div className="flex items-center gap-6 justify-between md:justify-end shrink-0">
        {isActive && (
          <div className="flex gap-4 text-xs font-mono">
            <div className="text-cyan-400">
              <span className="text-text-dim text-[10px] block uppercase font-medium tracking-wide">Speed</span>
              {Number(task.uploadSpeed) > 0 ? `↓ ${speed} | ↑ ${formatSpeed(task.uploadSpeed)}` : speed}
            </div>
            <div className="text-text-main">
              <span className="text-text-dim text-[10px] block uppercase font-medium tracking-wide">ETA</span>
              {eta}
            </div>
          </div>
        )}
        
        {isPaused && (
          <div className="text-amber-500 text-xs font-mono">
            <span className="text-text-dim text-[10px] block uppercase font-medium tracking-wide">Status</span>
            Paused
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 md:border-l md:border-border-main md:pl-4 pl-0 border-l-0">
          {isActive ? (
            <button 
              onClick={() => onPause(task.gid)}
              className="text-text-dim hover:text-cyan-400 p-2 rounded-lg hover:bg-page-bg/40 transition-colors cursor-pointer"
              title="Pause download"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button 
              onClick={() => onResume(task.gid)}
              className="text-text-dim hover:text-cyan-400 p-2 rounded-lg hover:bg-page-bg/40 transition-colors cursor-pointer"
              title="Resume download"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}

          <button 
            onClick={() => onRemove(task)}
            className="text-text-dim hover:text-rose-400 p-2 rounded-lg hover:bg-page-bg/40 transition-colors cursor-pointer"
            title="Cancel/Delete download"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});

export default TaskCard;
