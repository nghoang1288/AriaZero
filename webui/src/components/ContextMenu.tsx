import { useEffect, useRef } from 'react';
import { Play, Pause, Trash2, Copy, Info } from 'lucide-react';
import type { Aria2Task } from '../useAria2';
import { getTaskName, isTorrent } from '../utils/taskUtils';

interface ContextMenuProps {
  x: number;
  y: number;
  task: Aria2Task;
  onClose: () => void;
  onPause: (gid: string) => void;
  onResume: (gid: string) => void;
  onRemove: (task: Aria2Task) => void;
  onSelect: (gid: string) => void;
  showToast: (toast: any) => void;
}

export default function ContextMenu({
  x,
  y,
  task,
  onClose,
  onPause,
  onResume,
  onRemove,
  onSelect,
  showToast
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const isActive = task.status === 'active';

  const handleCopyLink = () => {
    let linkToCopy = '';
    if (isTorrent(task)) {
      linkToCopy = task.bittorrent?.infoHash ? `magnet:?xt=urn:btih:${task.bittorrent.infoHash}` : '';
    } else {
      linkToCopy = task.files?.[0]?.uris?.[0]?.uri || '';
    }

    if (linkToCopy) {
      navigator.clipboard.writeText(linkToCopy);
      showToast({
        type: 'success',
        title: 'Link Copied',
        message: 'Download link copied to clipboard!'
      });
    } else {
      showToast({
        type: 'error',
        title: 'Copy Failed',
        message: 'No download URI available for this task.'
      });
    }
    onClose();
  };

  const menuWidth = 180;
  const menuHeight = 200;
  const adjustedX = window.innerWidth - x < menuWidth ? x - menuWidth : x;
  const adjustedY = window.innerHeight - y < menuHeight ? y - menuHeight : y;

  return (
    <div
      ref={menuRef}
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      className="fixed z-[100] w-44 bg-sidebar-bg border border-border-main rounded-xl p-1.5 shadow-2xl flex flex-col font-sans select-none animate-in fade-in duration-100"
    >
      <div className="px-2.5 py-1.5 border-b border-border-main/50 mb-1">
        <span className="text-[10px] text-text-dim font-bold block truncate max-w-full">
          {getTaskName(task)}
        </span>
      </div>

      {isActive ? (
        <button
          onClick={() => {
            onPause(task.gid);
            onClose();
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-main hover:bg-page-bg/60 hover:text-cyan-400 text-left transition-colors cursor-pointer"
        >
          <Pause className="w-3.5 h-3.5" />
          <span>Pause Task</span>
        </button>
      ) : (
        <button
          onClick={() => {
            onResume(task.gid);
            onClose();
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-main hover:bg-page-bg/60 hover:text-cyan-400 text-left transition-colors cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Resume Task</span>
        </button>
      )}

      <button
        onClick={handleCopyLink}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-main hover:bg-page-bg/60 hover:text-cyan-400 text-left transition-colors cursor-pointer"
      >
        <Copy className="w-3.5 h-3.5" />
        <span>Copy Source URL</span>
      </button>

      <button
        onClick={() => {
          onSelect(task.gid);
          onClose();
        }}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-main hover:bg-page-bg/60 hover:text-cyan-400 text-left transition-colors cursor-pointer"
      >
        <Info className="w-3.5 h-3.5" />
        <span>View Details</span>
      </button>

      <div className="border-t border-border-main/50 my-1" />

      <button
        onClick={() => {
          onRemove(task);
          onClose();
        }}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 text-left transition-colors cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Remove Task</span>
      </button>
    </div>
  );
}
