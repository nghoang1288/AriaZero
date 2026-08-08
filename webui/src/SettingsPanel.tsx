import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronDown,
  RefreshCw,
  Server,
  Settings,
  Globe,
  Share2,
  Wrench,
  Folder,
  AlertCircle,
  Clock,
  Link,
} from 'lucide-react';
import { useToast } from './Toast';
import { useApiUrl } from './hooks/useApiUrl';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  globalOptions: Record<string, string>;
  updateGlobalOptions: (options: Record<string, string>) => void;
  fetchGlobalOptions: () => void;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
}

type OptionType = 'text' | 'number' | 'toggle' | 'select' | 'textarea' | 'readonly';

interface OptionDef {
  key: string;
  label: string;
  type: OptionType;
  choices?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface SectionDef {
  id: string;
  title: string;
  icon: React.ReactNode;
  options: OptionDef[];
}

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

const SECTIONS: SectionDef[] = [
  {
    id: 'basic',
    title: 'Basic Settings',
    icon: <Settings className="w-4 h-4" />,
    options: [
      { key: 'dir', label: 'Download Directory', type: 'readonly' },
      { key: 'max-concurrent-downloads', label: 'Max Concurrent Downloads', type: 'number', min: 1, max: 50 },
      { key: 'max-connection-per-server', label: 'Max Connections Per Server', type: 'number', min: 1, max: 16 },
      { key: 'min-split-size', label: 'Min Split Size', type: 'text', placeholder: '10M' },
      { key: 'split', label: 'Number of Splits', type: 'number', min: 1, max: 128 },
      { key: 'max-overall-download-limit', label: 'Max Overall Download Speed Limit', type: 'text', placeholder: '0 (unlimited)' },
      { key: 'max-download-limit', label: 'Max Download Speed Per Task', type: 'text', placeholder: '0 (unlimited)' },
      { key: 'max-overall-upload-limit', label: 'Max Overall Upload Speed Limit', type: 'text', placeholder: '0 (unlimited)' },
      { key: 'max-upload-limit', label: 'Max Upload Speed Per Task', type: 'text', placeholder: '0 (unlimited)' },
      { key: 'continue', label: 'Continue Download', type: 'toggle' },
      { key: 'file-allocation', label: 'File Allocation Method', type: 'select', choices: ['none', 'prealloc', 'trunc', 'falloc'] },
    ],
  },
  {
    id: 'http',
    title: 'HTTP / FTP / SFTP Settings',
    icon: <Globe className="w-4 h-4" />,
    options: [
      { key: 'http-accept-gzip', label: 'Accept Gzip', type: 'toggle' },
      { key: 'user-agent', label: 'User Agent', type: 'text', placeholder: 'aria2/...' },
      { key: 'check-certificate', label: 'Check SSL Certificate', type: 'toggle' },
      { key: 'ftp-pasv', label: 'FTP Use Passive Mode', type: 'toggle' },
    ],
  },
  {
    id: 'bt',
    title: 'BitTorrent Settings',
    icon: <Share2 className="w-4 h-4" />,
    options: [
      { key: 'bt-enable-lpd', label: 'Enable Local Peer Discovery', type: 'toggle' },
      { key: 'bt-max-peers', label: 'Max Peers per Torrent', type: 'number', min: 0 },
      { key: 'bt-request-peer-speed-limit', label: 'Request Peer Speed Limit', type: 'text', placeholder: '0 (unlimited)' },
      { key: 'dht-listen-port', label: 'DHT Listen Port', type: 'text', placeholder: '6881-6999' },
      { key: 'listen-port', label: 'Listen Port for BitTorrent', type: 'text', placeholder: '6881-6999' },
      { key: 'seed-ratio', label: 'Seed Ratio', type: 'number', min: 0, step: 0.1, placeholder: '1.0' },
      { key: 'seed-time', label: 'Seed Time (minutes, 0 = unlimited)', type: 'number', min: 0 },
      { key: 'bt-tracker', label: 'BT Tracker Servers', type: 'textarea', placeholder: 'Comma-separated tracker URLs' },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced Settings',
    icon: <Wrench className="w-4 h-4" />,
    options: [
      { key: 'save-session-interval', label: 'Save Session Interval (seconds)', type: 'number', min: 0 },
      { key: 'disk-cache', label: 'Disk Cache Size', type: 'text', placeholder: '16M' },
      { key: 'max-tries', label: 'Max Retries', type: 'number', min: 0 },
      { key: 'retry-wait', label: 'Retry Wait (seconds)', type: 'number', min: 0 },
      { key: 'timeout', label: 'Timeout (seconds)', type: 'number', min: 1 },
      { key: 'connect-timeout', label: 'Connect Timeout (seconds)', type: 'number', min: 1 },
      { key: 'log-level', label: 'Log Level', type: 'select', choices: ['debug', 'info', 'notice', 'warn', 'error'] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedCallback<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useCallback(
    ((...args: any[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    }) as T,
    [delay],
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
        border-2 border-transparent transition-colors duration-200 ease-in-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
        ${checked ? 'bg-cyan-500' : 'bg-slate-700'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg
          ring-0 transition-transform duration-200 ease-in-out
          ${checked ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  );
}

function TextControl({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const debouncedCommit = useDebouncedCallback((v: string) => onCommit(v), 500);

  // Sync upstream → local when globalOptions refresh
  useEffect(() => setLocal(value), [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    debouncedCommit(v);
  };

  const handleBlur = () => {
    if (local !== value) onCommit(local);
  };

  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/70 transition-colors"
    />
  );
}

// Custom appearance for numbers
function NumberControl({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: string;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const debouncedCommit = useDebouncedCallback((v: string) => onCommit(v), 500);

  useEffect(() => setLocal(value), [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setLocal(v);
    debouncedCommit(v);
  };

  const handleBlur = () => {
    if (local !== value) onCommit(local);
  };

  return (
    <input
      type="number"
      value={local}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/70 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

function TextareaControl({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const debouncedCommit = useDebouncedCallback((v: string) => onCommit(v), 500);

  useEffect(() => setLocal(value), [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocal(v);
    debouncedCommit(v);
  };

  const handleBlur = () => {
    if (local !== value) onCommit(local);
  };

  return (
    <textarea
      rows={3}
      value={local}
      placeholder={placeholder}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/70 transition-colors resize-y"
    />
  );
}

function SelectControl({
  value,
  choices,
  onCommit,
}: {
  value: string;
  choices: string[];
  onCommit: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70 transition-colors cursor-pointer appearance-none"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 24 24'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.75rem center',
      }}
    >
      {choices.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Connection Info Section
// ---------------------------------------------------------------------------

function ConnectionSection({ connectionStatus }: { connectionStatus: SettingsPanelProps['connectionStatus'] }) {
  const statusBadge = (() => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            Connected
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            Connecting…
          </span>
        );
      case 'disconnected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            Disconnected
          </span>
        );
    }
  })();

  const info = [
    { label: 'Server Host', value: location.hostname || 'localhost' },
    { label: 'Server Port', value: location.port || (location.protocol === 'https:' ? '443' : '80') },
    { label: 'Protocol', value: location.protocol === 'https:' ? 'wss' : 'ws' },
    { label: 'RPC Path', value: '/jsonrpc' },
  ];

  return (
    <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-main">
        <div className="flex items-center gap-2.5">
          <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-400">
            <Server className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Connection Information</h2>
        </div>
        {statusBadge}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5">
        {info.map((i) => (
          <div key={i.label}>
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium block mb-1.5">
              {i.label}
            </span>
            <div className="bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 font-mono">
              {i.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible settings section
// ---------------------------------------------------------------------------

function SettingsSection({
  section,
  globalOptions,
  onUpdate,
}: {
  section: SectionDef;
  globalOptions: Record<string, string>;
  onUpdate: (key: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-400">
            {section.icon}
          </div>
          <h2 className="text-sm font-semibold text-slate-200">{section.title}</h2>
          <span className="text-[10px] text-slate-600 font-mono">
            ({section.options.length})
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main">
          {section.options.map((opt) => (
            <OptionRow key={opt.key} opt={opt} value={globalOptions[opt.key] ?? ''} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single option row
// ---------------------------------------------------------------------------

function OptionRow({
  opt,
  value,
  onUpdate,
}: {
  opt: OptionDef;
  value: string;
  onUpdate: (key: string, value: string) => void;
}) {
  const commit = (v: string) => onUpdate(opt.key, v);

  const renderControl = () => {
    switch (opt.type) {
      case 'readonly':
        return (
          <div className="bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-400 font-mono flex items-center gap-1.5">
            <Folder className="w-3 h-3 text-slate-500 shrink-0" />
            <span className="truncate">{value || '—'}</span>
          </div>
        );
      case 'toggle':
        return (
          <ToggleSwitch checked={value === 'true'} onChange={(v) => commit(v ? 'true' : 'false')} />
        );
      case 'select':
        return <SelectControl value={value} choices={opt.choices ?? []} onCommit={commit} />;
      case 'number':
        return (
          <NumberControl value={value} min={opt.min} max={opt.max} step={opt.step} onCommit={commit} />
        );
      case 'textarea':
        return <TextareaControl value={value} placeholder={opt.placeholder} onCommit={commit} />;
      case 'text':
      default:
        return <TextControl value={value} placeholder={opt.placeholder} onCommit={commit} />;
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
      {/* Label side */}
      <div className="sm:max-w-[55%]">
        <span className="text-xs font-semibold text-slate-200 block">{opt.label}</span>
        <code className="text-[10px] text-slate-500 font-mono">{opt.key}</code>
      </div>

      {/* Control side */}
      <div className={`${opt.type === 'toggle' ? '' : 'w-full sm:w-56'}`}>
        {renderControl()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SettingsPanel({
  globalOptions,
  updateGlobalOptions,
  fetchGlobalOptions,
  connectionStatus,
}: SettingsPanelProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchGlobalOptions();
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleUpdate = (key: string, value: string) => {
    updateGlobalOptions({ [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400">
          Aria2 Global Settings
        </h2>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-card-bg border border-border-main text-slate-300
                     hover:border-cyan-500/40 hover:text-cyan-400 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh Settings
        </button>
      </div>

      {/* Connection info */}
      <ConnectionSection connectionStatus={connectionStatus} />

      {/* Scheduler section */}
      <SchedulerSection />

      {/* Smart Download Preferences */}
      <SmartDownloadSettingsSection />

      {/* AriaZero Pro Features */}
      <AriaZeroFeaturesSection />

      {/* Option sections */}
      {SECTIONS.map((section) => (
        <SettingsSection
          key={section.id}
          section={section}
          globalOptions={globalOptions}
          onUpdate={handleUpdate}
        />
      ))}

      {/* Integrations */}
      <IntegrationsSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduler Section Component
// ---------------------------------------------------------------------------

function SchedulerSection() {
  const [expanded, setExpanded] = useState(true);
  const [enabled, setEnabled] = useState(() => localStorage.getItem('ariazero_scheduler_enabled') === 'true');
  const [start, setStart] = useState(() => localStorage.getItem('ariazero_scheduler_start') || '08:00');
  const [end, setEnd] = useState(() => localStorage.getItem('ariazero_scheduler_end') || '18:00');
  const [dlLimit, setDlLimit] = useState(() => localStorage.getItem('ariazero_scheduler_dl_limit') || '500K');
  const [ulLimit, setUlLimit] = useState(() => localStorage.getItem('ariazero_scheduler_ul_limit') || '50K');
  const [dlNormal, setDlNormal] = useState(() => localStorage.getItem('ariazero_scheduler_dl_normal') || '0');
  const [ulNormal, setUlNormal] = useState(() => localStorage.getItem('ariazero_scheduler_ul_normal') || '0');

  const update = (key: string, value: string) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event('ariazero_scheduler_changed'));
  };

  return (
    <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden mb-6">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-400">
            <Clock className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Bandwidth Scheduler</h2>
          <span className="text-[10px] text-slate-600 font-mono">
            (Client-side profiles)
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main">
          {/* Toggle Enabled */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Enable Scheduler</span>
              <span className="text-[10px] text-slate-500">Enable automatic client-side speed limit switching</span>
            </div>
            <div>
              <ToggleSwitch
                checked={enabled}
                onChange={(val) => {
                  setEnabled(val);
                  update('ariazero_scheduler_enabled', String(val));
                }}
              />
            </div>
          </div>

          {/* Time range */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Scheduler Limit Period</span>
              <span className="text-[10px] text-slate-500 font-mono">Start and End time for limits</span>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-56">
              <input
                type="time"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  update('ariazero_scheduler_start', e.target.value);
                }}
                className="w-1/2 bg-input-bg border border-border-main rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
              <span className="text-slate-500 text-xs">to</span>
              <input
                type="time"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  update('ariazero_scheduler_end', e.target.value);
                }}
                className="w-1/2 bg-input-bg border border-border-main rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          {/* Download limit */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Download Speed Limit</span>
              <span className="text-[10px] text-slate-500 font-mono">e.g., 500K, 2M, 0 for unlimited</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={dlLimit}
                onChange={(e) => {
                  setDlLimit(e.target.value);
                  update('ariazero_scheduler_dl_limit', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          {/* Upload limit */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Upload Speed Limit</span>
              <span className="text-[10px] text-slate-500 font-mono">e.g., 50K, 100K, 0 for unlimited</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={ulLimit}
                onChange={(e) => {
                  setUlLimit(e.target.value);
                  update('ariazero_scheduler_ul_limit', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          {/* Normal Download Limit */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Normal Download Limit</span>
              <span className="text-[10px] text-slate-500 font-mono">Limit outside the scheduled hours</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={dlNormal}
                onChange={(e) => {
                  setDlNormal(e.target.value);
                  update('ariazero_scheduler_dl_normal', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          {/* Normal Upload Limit */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Normal Upload Limit</span>
              <span className="text-[10px] text-slate-500 font-mono">Limit outside the scheduled hours</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={ulNormal}
                onChange={(e) => {
                  setUlNormal(e.target.value);
                  update('ariazero_scheduler_ul_normal', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smart Download Settings Section Component
// ---------------------------------------------------------------------------

function SmartDownloadSettingsSection() {
  const [expanded, setExpanded] = useState(true);
  const { showToast } = useToast();
  const [extensions, setExtensions] = useState(() => {
    return localStorage.getItem('ariazero_custom_extensions') || 
      'zip,rar,7z,tar,gz,bz2,xz,iso,exe,msi,dmg,pkg,deb,rpm,apk,mp4,mkv,avi,mov,mp3,flac,wav,pdf,epub,torrent,gguf,safetensors,bin,ckpt,pth';
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setExtensions(value);
    localStorage.setItem('ariazero_custom_extensions', value);
    window.dispatchEvent(new Event('ariazero_extensions_changed'));
  };

  const handleRegisterProtocol = () => {
    try {
      navigator.registerProtocolHandler(
        'magnet',
        window.location.origin + '/?uri=%s'
      );
      showToast({
        type: 'success',
        title: 'Đăng ký Handler thành công',
        message: 'Trình duyệt sẽ nhắc bạn xác nhận quyền xử lý liên kết magnet.',
        duration: 5000
      });
    } catch (e) {
      console.error(e);
      showToast({
        type: 'error',
        title: 'Lỗi đăng ký',
        message: 'Trình duyệt hoặc cấu hình bảo mật không cho phép đăng ký trực tiếp.',
        duration: 5000
      });
    }
  };

  return (
    <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden mb-6">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-400">
            <Globe className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Smart Download Settings</h2>
          <span className="text-[10px] text-slate-600 font-mono">
            (WebUI Preferences)
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Allowed File Extensions</span>
              <span className="text-[10px] text-slate-500">Comma-separated list of extensions that trigger clipboard capture and drag-drop</span>
            </div>
            <div className="w-full sm:w-80">
              <input
                type="text"
                value={extensions}
                onChange={handleChange}
                placeholder="e.g. zip,rar,mp4,gguf"
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70 font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Browser Magnet Association</span>
              <span className="text-[10px] text-slate-500">Clicking magnet links in this browser will open them directly in AriaZero</span>
            </div>
            <div className="w-full sm:w-auto flex justify-end">
              <button
                type="button"
                onClick={handleRegisterProtocol}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-500 text-white hover:bg-cyan-600 transition-colors shadow-lg shadow-cyan-500/20"
              >
                <Link className="w-3.5 h-3.5" />
                Register Magnet Handler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AriaZeroFeaturesSection() {
  const [expanded, setExpanded] = useState(true);

  // Auto-Retry State
  const [retryEnabled, setRetryEnabled] = useState(() => {
    const val = localStorage.getItem('ariazero_auto_retry_enabled');
    return val === null ? true : val === 'true';
  });
  const [retryCount, setRetryCount] = useState(() => {
    return Number(localStorage.getItem('ariazero_auto_retry_count') || '3');
  });
  const [retryDelay, setRetryDelay] = useState(() => {
    return Number(localStorage.getItem('ariazero_auto_retry_delay') || '5');
  });

  // Auto-Categorize State
  const [categorizeEnabled, setCategorizeEnabled] = useState(() => {
    const val = localStorage.getItem('ariazero_auto_categorize_enabled');
    return val === null ? true : val === 'true';
  });
  const [videoFolder, setVideoFolder] = useState(() => {
    return localStorage.getItem('ariazero_video_folder') || 'Video';
  });
  const [audioFolder, setAudioFolder] = useState(() => {
    return localStorage.getItem('ariazero_audio_folder') || 'Audio';
  });
  const [docFolder, setDocFolder] = useState(() => {
    return localStorage.getItem('ariazero_doc_folder') || 'Documents';
  });
  const [softwareFolder, setSoftwareFolder] = useState(() => {
    return localStorage.getItem('ariazero_software_folder') || 'Software';
  });

  // Sound Notification State
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const val = localStorage.getItem('ariazero_sound_enabled');
    return val === null ? true : val === 'true';
  });

  // Movie Metadata State
  const [omdbApiKey, setOmdbApiKey] = useState(() => {
    return localStorage.getItem('ariazero_omdb_api_key') || '';
  });

  const update = (key: string, value: string) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event('ariazero_settings_changed'));
  };

  return (
    <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden mb-6">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-400">
            <Wrench className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">AriaZero Pro Features</h2>
          <span className="text-[10px] text-slate-600 font-mono">
            (Auto-Retry, Categorization, Sound alerts)
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main">
          {/* Section Subtitle: Auto-Retry */}
          <div className="px-5 py-2.5 bg-slate-800/20">
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Auto-Retry on Error</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Enable Auto-Retry</span>
              <span className="text-[10px] text-slate-500">Automatically retry failed downloads</span>
            </div>
            <div>
              <ToggleSwitch
                checked={retryEnabled}
                onChange={(val) => {
                  setRetryEnabled(val);
                  update('ariazero_auto_retry_enabled', String(val));
                }}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Max Retry Attempts</span>
              <span className="text-[10px] text-slate-500">Number of retries before giving up</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="number"
                min={0}
                value={retryCount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setRetryCount(val);
                  update('ariazero_auto_retry_count', String(val));
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Retry Delay (Seconds)</span>
              <span className="text-[10px] text-slate-500">Wait time before each retry attempt</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="number"
                min={1}
                value={retryDelay}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setRetryDelay(val);
                  update('ariazero_auto_retry_delay', String(val));
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          {/* Section Subtitle: Auto-Categorize */}
          <div className="px-5 py-2.5 bg-slate-800/20 border-t border-border-main">
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Auto-Categorize Downloads</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Enable Auto-Categorize</span>
              <span className="text-[10px] text-slate-500">Route files to folders based on file extensions</span>
            </div>
            <div>
              <ToggleSwitch
                checked={categorizeEnabled}
                onChange={(val) => {
                  setCategorizeEnabled(val);
                  update('ariazero_auto_categorize_enabled', String(val));
                }}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Video Subfolder</span>
              <span className="text-[10px] text-slate-500">Subfolder path under the download folder</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={videoFolder}
                onChange={(e) => {
                  setVideoFolder(e.target.value);
                  update('ariazero_video_folder', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Audio Subfolder</span>
              <span className="text-[10px] text-slate-500">Subfolder path under the download folder</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={audioFolder}
                onChange={(e) => {
                  setAudioFolder(e.target.value);
                  update('ariazero_audio_folder', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Documents Subfolder</span>
              <span className="text-[10px] text-slate-500">Subfolder path under the download folder</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={docFolder}
                onChange={(e) => {
                  setDocFolder(e.target.value);
                  update('ariazero_doc_folder', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Software Subfolder</span>
              <span className="text-[10px] text-slate-500">Subfolder path under the download folder</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                value={softwareFolder}
                onChange={(e) => {
                  setSoftwareFolder(e.target.value);
                  update('ariazero_software_folder', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          {/* Section Subtitle: Notification */}
          <div className="px-5 py-2.5 bg-slate-800/20 border-t border-border-main">
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Notification Sound</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Complete Sound Alert</span>
              <span className="text-[10px] text-slate-500">Play a chime sound when a download completes</span>
            </div>
            <div>
              <ToggleSwitch
                checked={soundEnabled}
                onChange={(val) => {
                  setSoundEnabled(val);
                  update('ariazero_sound_enabled', String(val));
                }}
              />
            </div>
          </div>

          {/* Section Subtitle: Movie Metadata */}
          <div className="px-5 py-2.5 bg-slate-800/20 border-t border-border-main">
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Movie Metadata (OMDb API)</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">OMDb API Key</span>
              <span className="text-[10px] text-slate-500">Provide an API key from omdbapi.com to load movie genres, RT score, plot synopsis and poster</span>
            </div>
            <div className="w-full sm:w-56">
              <input
                type="text"
                placeholder="e.g. 2b2ca076"
                value={omdbApiKey}
                onChange={(e) => {
                  setOmdbApiKey(e.target.value);
                  update('ariazero_omdb_api_key', e.target.value);
                }}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integrations Section
// ---------------------------------------------------------------------------
function IntegrationsSection() {
  const [expanded, setExpanded] = useState(false);
  const [jellyfinUrl, setJellyfinUrl] = useState('');
  const [jellyfinApiKey, setJellyfinApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const { getApiUrl } = useApiUrl();
  const { showToast } = useToast();

  // Load from backend
  useEffect(() => {
    fetch(`${getApiUrl('settings')}`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          if (data.jellyfin_url) setJellyfinUrl(data.jellyfin_url);
          if (data.jellyfin_api_key) setJellyfinApiKey(data.jellyfin_api_key);
        }
      })
      .catch(err => console.error("Failed to load settings", err));
  }, [getApiUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${getApiUrl('settings')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jellyfin_url: jellyfinUrl,
          jellyfin_api_key: jellyfinApiKey
        })
      });
      if (resp.ok) {
        showToast({ title: 'Saved', message: 'Integration settings saved to server.', type: 'success' });
      } else {
        throw new Error("Server returned " + resp.status);
      }
    } catch (e: any) {
      showToast({ title: 'Error', message: e.message || 'Failed to save', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card-bg border border-border-main rounded-xl overflow-hidden mb-6">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-5 py-4 text-left group hover:bg-slate-800/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/20 text-cyan-400">
            <Link className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-slate-200">Integrations</h2>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-border-main divide-y divide-border-main">
          <div className="px-5 py-2.5 bg-slate-800/20 border-b border-border-main">
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Jellyfin Auto-Refresh</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Jellyfin URL</span>
              <span className="text-[10px] text-slate-500">e.g., http://192.168.50.226:8096</span>
            </div>
            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="http://192.168.50.226:8096"
                value={jellyfinUrl}
                onChange={(e) => setJellyfinUrl(e.target.value)}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3.5 hover:bg-slate-800/10 transition-colors">
            <div className="sm:max-w-[55%]">
              <span className="text-xs font-semibold text-slate-200 block">Jellyfin API Key</span>
              <span className="text-[10px] text-slate-500">Generate this in Jellyfin Dashboard &rarr; Advanced &rarr; API Keys</span>
            </div>
            <div className="w-full sm:w-64">
              <input
                type="password"
                placeholder="API Key..."
                value={jellyfinApiKey}
                onChange={(e) => setJellyfinApiKey(e.target.value)}
                className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          </div>

          <div className="px-5 py-3.5 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-cyan-500 hover:bg-cyan-600 text-white font-medium text-xs px-4 py-2 rounded-lg shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
