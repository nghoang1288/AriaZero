import { useState, useEffect, useRef, useMemo } from 'react';
import { X, AlertCircle, Folder, FolderOpen, File, ChevronRight, ChevronDown } from 'lucide-react';
import { formatBytes, formatSpeed } from '../useAria2';
import type { Aria2Task } from '../useAria2';
import { getTaskName } from '../utils/taskUtils';
import { useToast } from '../Toast';
import { getApiUrl } from '../hooks/useApiUrl';

interface TaskDetailsDrawerProps {
  selectedTask: Aria2Task | null | undefined;
  onClose: () => void;
  taskPeers: any[];
  taskServers: any[];
  retryTask: (task: Aria2Task) => void;
  changeTaskOption: (gid: string, options: Record<string, string>) => Promise<any>;
  getTaskOptions: (gid: string) => Promise<any>;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: Record<string, TreeNode>;
  fileIndex?: number;
  fileData?: any;
}

const buildFileTree = (files: any[]) => {
  const root: TreeNode = { name: 'Root', path: '', isFolder: true, children: {} };

  files.forEach((file, index) => {
    if (!file.path) {
      const name = file.uris?.[0]?.uri || `File ${index + 1}`;
      root.children[name] = {
        name,
        path: '',
        isFolder: false,
        children: {},
        fileIndex: index,
        fileData: file
      };
      return;
    }

    const normalizedPath = file.path.replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter(Boolean);

    if (segments[0] === 'downloads') {
      segments.shift();
    }

    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast) {
        current.children[segment] = {
          name: segment,
          path: file.path,
          isFolder: false,
          children: {},
          fileIndex: index,
          fileData: file
        };
      } else {
        if (!current.children[segment]) {
          current.children[segment] = {
            name: segment,
            path: segments.slice(0, i + 1).join('/'),
            isFolder: true,
            children: {}
          };
        }
        current = current.children[segment];
      }
    }
  });

  return root;
};

interface FileTreeNodeProps {
  node: TreeNode;
  verifyFileHash: (filePath: string) => void;
  hashStatuses: Record<string, { status: string; progress?: number; hash?: string; error?: string }>;
  showToast: (toast: any) => void;
}

function FileTreeNode({ node, verifyFileHash, hashStatuses, showToast }: FileTreeNodeProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!node.isFolder) {
    const file = node.fileData;
    const fLength = Number(file.length);
    const fCompleted = Number(file.completedLength);
    const fProgress = fLength > 0 ? Math.min(Math.round((fCompleted / fLength) * 100), 100) : 0;
    const hasPath = !!file.path;
    const fileHashState = hashStatuses[file.path] || { status: 'not_started' };

    return (
      <div className="bg-page-bg/40 border border-border-main/50 rounded-lg p-2.5 space-y-1.5 ml-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <File className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
            <span className="text-xs font-medium text-text-main break-all select-all">{node.name}</span>
          </div>
          <span className="text-[10px] text-text-dim shrink-0 font-mono">{formatBytes(file.length)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-page-bg/40 border border-border-main/20 rounded-full h-1 overflow-hidden">
            <div style={{ width: `${fProgress}%` }} className="h-full rounded-full bg-cyan-500" />
          </div>
          <span className="text-[9px] font-mono text-text-dim">{fProgress}%</span>
        </div>
        {hasPath && fProgress === 100 && (
          <div className="pt-1.5 border-t border-border-main/10 flex flex-col gap-1 text-[10px]">
            {fileHashState.status === 'not_started' && (
              <button
                onClick={() => verifyFileHash(file.path)}
                className="self-start text-[9px] text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer py-0.5"
              >
                🔍 Calculate SHA-256 Hash
              </button>
            )}
            {(fileHashState.status === 'starting' || fileHashState.status === 'processing') && (
              <div className="flex items-center justify-between text-text-dim">
                <span>Calculating SHA-256...</span>
                <span className="font-mono text-cyan-400">{fileHashState.progress || 0}%</span>
              </div>
            )}
            {fileHashState.status === 'completed' && (
              <div className="space-y-1">
                <span className="text-[9px] text-emerald-400 font-semibold block">✓ SHA-256 Verified:</span>
                <div className="flex items-center gap-1.5 bg-slate-950/30 p-1 rounded border border-border-main/50">
                  <span className="font-mono text-[9px] text-text-main break-all select-all flex-1">{fileHashState.hash}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(fileHashState.hash || '');
                      showToast({
                        type: 'success',
                        title: 'Hash Copied',
                        message: 'SHA-256 hash copied to clipboard!'
                      });
                    }}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold text-[9px] px-1 cursor-pointer shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            {fileHashState.status === 'failed' && (
              <span className="text-rose-400 block">✗ Verification failed: {fileHashState.error}</span>
            )}
          </div>
        )}
      </div>
    );
  }

  const childKeys = Object.keys(node.children);
  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-page-bg/40 text-text-main/90 hover:text-text-main text-xs transition-colors cursor-pointer select-none"
      >
        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-text-dim" /> : <ChevronRight className="w-3.5 h-3.5 text-text-dim" />}
        {isOpen ? <FolderOpen className="w-3.5 h-3.5 text-cyan-400" /> : <Folder className="w-3.5 h-3.5 text-cyan-400" />}
        <span className="font-medium truncate">{node.name}</span>
      </button>

      {isOpen && (
        <div className="pl-3.5 border-l border-border-main/40 ml-2 space-y-1.5">
          {childKeys.map((key) => (
            <FileTreeNode
              key={key}
              node={node.children[key]}
              verifyFileHash={verifyFileHash}
              hashStatuses={hashStatuses}
              showToast={showToast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TaskDetailsDrawer({
  selectedTask,
  onClose,
  taskPeers,
  taskServers,
  retryTask,
  changeTaskOption,
  getTaskOptions,
}: TaskDetailsDrawerProps) {
  const [drawerTab, setDrawerTab] = useState<'files' | 'peers' | 'trackers'>('files');
  const { showToast } = useToast();

  const [dlLimitInput, setDlLimitInput] = useState('0');
  const [ulLimitInput, setUlLimitInput] = useState('0');
  const [isSavingOptions, setIsSavingOptions] = useState(false);

  // Fetch task options when selected GID changes
  useEffect(() => {
    if (selectedTask?.gid) {
      setDlLimitInput('0');
      setUlLimitInput('0');
      getTaskOptions(selectedTask.gid)
        .then((opts) => {
          if (opts) {
            setDlLimitInput(opts['max-download-limit'] || '0');
            setUlLimitInput(opts['max-upload-limit'] || '0');
          }
        })
        .catch((err) => {
          console.error('Failed to load task options:', err);
        });
    }
  }, [selectedTask?.gid, getTaskOptions]);

  const handleSaveOptions = async () => {
    if (!selectedTask?.gid) return;
    setIsSavingOptions(true);
    try {
      await changeTaskOption(selectedTask.gid, {
        'max-download-limit': dlLimitInput,
        'max-upload-limit': ulLimitInput,
      });
      showToast({
        type: 'success',
        title: 'Task Options Updated',
        message: 'Successfully updated speed limits for this task.',
      });
    } catch (err: any) {
      console.error('Failed to save task options:', err);
      showToast({
        type: 'error',
        title: 'Update Failed',
        message: err.message || 'Failed to update task speed limits.',
      });
    } finally {
      setIsSavingOptions(false);
    }
  };

  const [hashStatuses, setHashStatuses] = useState<Record<string, { status: string; progress?: number; hash?: string; error?: string }>>({});
  const hashPollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    return () => {
      // Clear all active intervals when the drawer is closed / unmounted
      Object.values(hashPollIntervalsRef.current).forEach(clearInterval);
    };
  }, []);

  const verifyFileHash = async (filePath: string) => {
    if (!filePath) return;
    
    setHashStatuses(prev => ({
      ...prev,
      [filePath]: { status: 'starting', progress: 0 }
    }));
    
    try {
      const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      
      const res = await fetch(getApiUrl('file-hash'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: filePath })
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start hash check');
      }
      
      const data = await res.json();
      setHashStatuses(prev => ({
        ...prev,
        [filePath]: data
      }));
      
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(getApiUrl(`file-hash/status?path=${encodeURIComponent(filePath)}`), {
            headers
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setHashStatuses(prev => ({
              ...prev,
              [filePath]: statusData
            }));
            
            if (statusData.status === 'completed' || statusData.status === 'failed') {
              clearInterval(pollInterval);
              delete hashPollIntervalsRef.current[filePath];
            }
          } else {
            clearInterval(pollInterval);
            delete hashPollIntervalsRef.current[filePath];
          }
        } catch (pollErr) {
          clearInterval(pollInterval);
          delete hashPollIntervalsRef.current[filePath];
        }
      }, 1000);

      hashPollIntervalsRef.current[filePath] = pollInterval;
      
    } catch (err: any) {
      setHashStatuses(prev => ({
        ...prev,
        [filePath]: { status: 'failed', error: err.message || 'Error occurred' }
      }));
    }
  };

  // Convert hex bitfield to binary array
  const hexCharToBin = (char: string): string => {
    const num = parseInt(char, 16);
    if (isNaN(num)) return '0000';
    return num.toString(2).padStart(4, '0');
  };

  const pieces = useMemo(() => {
    let binString = '';
    if (selectedTask?.bitfield) {
      for (let i = 0; i < selectedTask.bitfield.length; i++) {
        binString += hexCharToBin(selectedTask.bitfield[i]);
      }
    }
    const totalPieces = Number(selectedTask?.numPieces || 0) || binString.length;
    return binString.slice(0, totalPieces).split('').map(b => b === '1');
  }, [selectedTask?.bitfield, selectedTask?.numPieces]);

  const totalPieces = Number(selectedTask?.numPieces || 0) || pieces.length;

  const segments = useMemo(() => {
    const numSegments = 100;
    const list: { completedCount: number; totalCount: number; ratio: number }[] = [];
    if (totalPieces > 0 && pieces.length > 0) {
      const chunkSize = pieces.length / numSegments;
      for (let i = 0; i < numSegments; i++) {
        const start = Math.floor(i * chunkSize);
        const end = Math.floor((i + 1) * chunkSize);
        let completedCount = 0;
        const totalCount = end - start;
        for (let j = start; j < end; j++) {
          if (pieces[j]) completedCount++;
        }
        list.push({
          completedCount,
          totalCount,
          ratio: totalCount > 0 ? completedCount / totalCount : 0
        });
      }
    }
    return list;
  }, [pieces, totalPieces]);

  const getSegmentColor = (ratio: number) => {
    if (ratio === 1) return 'bg-cyan-500 shadow-sm shadow-cyan-500/20';
    if (ratio > 0) return 'bg-cyan-300/70 border border-cyan-400/30';
    return 'bg-slate-700/30 border border-slate-700/20';
  };

  if (!selectedTask) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-full sm:w-[420px] bg-sidebar-bg border-l border-border-main shadow-2xl z-[80] flex flex-col transition-all duration-300 transform translate-x-0">
      {/* Drawer Header */}
      <div className="p-5 border-b border-border-main flex items-center justify-between">
        <div className="min-w-0">
          <span className="text-[9px] text-text-dim font-mono tracking-wider block mb-1">TASK DETAILS ({selectedTask.gid})</span>
          <h3 className="text-xs font-semibold text-text-main truncate pr-4" title={getTaskName(selectedTask)}>
            {getTaskName(selectedTask)}
          </h3>
        </div>
        <button 
          onClick={onClose}
          className="text-text-dim hover:text-text-main p-1 rounded transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Drawer Tabs */}
      <div className="flex border-b border-border-main bg-page-bg/20 text-xs">
        <button 
          onClick={() => setDrawerTab('files')}
          className={`flex-1 py-3 text-center font-medium border-b-2 transition-all cursor-pointer ${
            drawerTab === 'files' ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5' : 'border-transparent text-text-dim hover:text-text-main'
          }`}
        >
          Files ({selectedTask.files?.length || 0})
        </button>
        <button 
          onClick={() => setDrawerTab('peers')}
          className={`flex-1 py-3 text-center font-medium border-b-2 transition-all cursor-pointer ${
            drawerTab === 'peers' ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5' : 'border-transparent text-text-dim hover:text-text-main'
          }`}
        >
          Connections
        </button>
        <button 
          onClick={() => setDrawerTab('trackers')}
          className={`flex-1 py-3 text-center font-medium border-b-2 transition-all cursor-pointer ${
            drawerTab === 'trackers' ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5' : 'border-transparent text-text-dim hover:text-text-main'
          }`}
        >
          Metadata
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {selectedTask.status === 'error' && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-xs space-y-3 animate-in slide-in-from-top duration-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-rose-400">Download Error</h4>
                <p className="text-text-dim mt-1 font-mono text-[11px] break-words">
                  Code {selectedTask.errorCode || 'Unknown'}: {selectedTask.errorMessage || 'No details available.'}
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button 
                onClick={() => retryTask(selectedTask)}
                className="bg-cyan-500 hover:bg-cyan-600 text-white font-medium text-[11px] px-3 py-1 rounded-lg transition-colors cursor-pointer"
              >
                Retry Download
              </button>
            </div>
          </div>
        )}

        {/* Bitfield Segment Visualizer */}
        {selectedTask.bitfield && (
          <div className="bg-page-bg border border-border-main rounded-xl p-3.5 space-y-2">
            <span className="text-[10px] font-semibold text-text-dim uppercase tracking-wider block">Download Segments</span>
            <div className="grid grid-cols-10 gap-1.5 p-1 bg-slate-950/20 rounded-lg border border-border-main/50 font-mono">
              {segments.map((seg, idx) => (
                <div
                  key={idx}
                  className={`h-3.5 rounded-xs transition-all ${getSegmentColor(seg.ratio)}`}
                  title={`Segment ${idx + 1}: ${seg.completedCount}/${seg.totalCount} pieces completed (${Math.round(seg.ratio * 100)}%)`}
                />
              ))}
            </div>
            <div className="flex items-center justify-between text-[9px] text-text-dim/80 font-mono px-0.5 font-semibold">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-cyan-500" /> Completed
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-cyan-300/70 border border-cyan-400/30" /> Partial
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-slate-700/30 border border-slate-700/20" /> Empty
              </span>
            </div>
          </div>
        )}

        {drawerTab === 'files' && (
          <div className="space-y-3">
            {Object.values(buildFileTree(selectedTask.files || []).children).map((childNode, idx) => (
              <FileTreeNode
                key={idx}
                node={childNode}
                verifyFileHash={verifyFileHash}
                hashStatuses={hashStatuses}
                showToast={showToast}
              />
            ))}
          </div>
        )}

        {drawerTab === 'peers' && (
          <div className="space-y-3">
            {selectedTask.bittorrent ? (
              <>
                <div className="flex items-center justify-between text-[10px] text-text-dim font-mono uppercase font-bold tracking-wider px-2">
                  <span>Peer IP / Client</span>
                  <span>Speed (Down / Up)</span>
                </div>
                {taskPeers.length === 0 ? (
                  <div className="text-center text-text-dim text-xs py-10 bg-page-bg border border-border-main border-dashed rounded-lg">
                    No active peer connections
                  </div>
                ) : (
                  taskPeers.map((peer: any, i: number) => (
                    <div key={i} className="bg-page-bg border border-border-main rounded-lg p-3 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-mono text-text-main block">{peer.ip}:{peer.port}</span>
                        <span className="text-[10px] text-text-dim">{peer.seeding === 'true' ? 'Seeding' : 'Leeching'}</span>
                      </div>
                      <div className="text-right font-mono">
                        <span className="text-cyan-400 block">↓ {formatSpeed(peer.downloadSpeed)}</span>
                        <span className="text-emerald-400 text-[10px] block">↑ {formatSpeed(peer.uploadSpeed)}</span>
                      </div>
                    </div>
                  ))
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-[10px] text-text-dim font-mono uppercase font-bold tracking-wider px-2">
                  <span>Server Connection</span>
                  <span>Active</span>
                </div>
                {taskServers.length === 0 ? (
                  <div className="text-center text-text-dim text-xs py-10 bg-page-bg border border-border-main border-dashed rounded-lg">
                    No active server connection stats
                  </div>
                ) : (
                  taskServers.map((server: any, i: number) => (
                    <div key={i} className="bg-page-bg border border-border-main rounded-lg p-3 text-xs space-y-1">
                      <div className="font-mono text-text-main break-all">{server.uri}</div>
                      <div className="flex justify-between text-[10px] text-text-dim font-mono">
                        <span>Conns: {server.currentConnections || 1}</span>
                        <span className="text-cyan-400">Active</span>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {drawerTab === 'trackers' && (
          <div className="space-y-4 text-xs">
            {/* Speed Limits controls */}
            <div className="bg-page-bg border border-border-main rounded-lg p-3 space-y-3">
              <span className="text-[10px] text-text-dim uppercase tracking-wider block font-semibold">Task Speed Limits</span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-text-dim block mb-1">Download Limit</label>
                  <input
                    type="text"
                    value={dlLimitInput}
                    onChange={(e) => setDlLimitInput(e.target.value)}
                    placeholder="e.g., 0, 500K, 1M"
                    className="w-full bg-input-bg border border-border-main rounded px-2 py-1 text-xs text-text-main focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-text-dim block mb-1">Upload Limit</label>
                  <input
                    type="text"
                    value={ulLimitInput}
                    onChange={(e) => setUlLimitInput(e.target.value)}
                    placeholder="e.g., 0, 50K, 1M"
                    className="w-full bg-input-bg border border-border-main rounded px-2 py-1 text-xs text-text-main focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-[9px] text-text-dim">0 = Unlimited (e.g. 500K, 1M)</span>
                <button
                  type="button"
                  onClick={handleSaveOptions}
                  disabled={isSavingOptions}
                  className="bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/35 text-cyan-400 font-semibold text-[10px] px-3 py-1 rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSavingOptions ? 'Saving...' : 'Apply Limits'}
                </button>
              </div>
            </div>

            {selectedTask.bittorrent ? (
              <div className="space-y-4">
                <div className="bg-page-bg border border-border-main rounded-lg p-3 space-y-2">
                  <div>
                    <span className="text-[10px] text-text-dim uppercase tracking-wider block">Info Hash</span>
                    <span className="font-mono text-text-main break-all select-all">{selectedTask.bittorrent.infoHash || '—'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[10px] text-text-dim uppercase tracking-wider block">Mode</span>
                      <span className="text-text-main capitalize">{selectedTask.bittorrent.mode || 'Single File'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-dim uppercase tracking-wider block">Seeders</span>
                      <span className="text-text-main">{selectedTask.numSeeders || '0'}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] text-text-dim font-mono uppercase font-bold tracking-wider px-2">Announce Trackers</span>
                  <div className="bg-page-bg border border-border-main rounded-lg divide-y divide-border-main max-h-60 overflow-y-auto">
                    {selectedTask.bittorrent.announceList?.map((list: any[], i: number) => (
                      <div key={i} className="p-2.5 font-mono text-[10px] text-text-dim break-all hover:bg-page-bg/25">
                        {list[0]}
                      </div>
                    )) || (
                      <div className="p-4 text-center text-text-dim italic">No trackers listed</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-page-bg border border-border-main rounded-lg p-3 space-y-3">
                <div>
                  <span className="text-[10px] text-text-dim uppercase tracking-wider block">GID</span>
                  <span className="font-mono text-text-main select-all">{selectedTask.gid}</span>
                </div>
                <div>
                  <span className="text-[10px] text-text-dim uppercase tracking-wider block">Connections</span>
                  <span className="font-mono text-text-main">{selectedTask.connections || '1'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-text-dim uppercase tracking-wider block">Status</span>
                  <span className="text-text-main capitalize">{selectedTask.status}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
