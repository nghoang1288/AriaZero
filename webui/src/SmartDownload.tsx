import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmartDownloadProps {
  children: React.ReactNode;
  onLinkDetected: (url: string, source?: 'url_param' | 'clipboard' | 'drag') => void;
  onTorrentDetected?: (base64: string, filename: string) => void;
}

interface SmartDownloadContextValue {
  isDragging: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SmartDownloadContext = createContext<SmartDownloadContextValue>({
  isDragging: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractUrls(text: string, regex: RegExp): string[] {
  const matches = text.match(regex);
  return matches ? [...new Set(matches)] : [];
}

function isInputElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SmartDownloadProvider({
  children,
  onLinkDetected,
  onTorrentDetected,
}: SmartDownloadProps): React.ReactNode {
  const [isDragging, setIsDragging] = useState(false);
  const lastDetectedRef = useRef<string>('');
  const dragCounterRef = useRef(0);

  // Load extensions list dynamically
  const [extensions, setExtensions] = useState(() => {
    return localStorage.getItem('ariazero_custom_extensions') || 
      'zip,rar,7z,tar,gz,bz2,xz,iso,exe,msi,dmg,pkg,deb,rpm,apk,mp4,mkv,avi,mov,mp3,flac,wav,pdf,epub,torrent,gguf,safetensors,bin,ckpt,pth';
  });

  useEffect(() => {
    const handleUpdate = () => {
      setExtensions(localStorage.getItem('ariazero_custom_extensions') || 
        'zip,rar,7z,tar,gz,bz2,xz,iso,exe,msi,dmg,pkg,deb,rpm,apk,mp4,mkv,avi,mov,mp3,flac,wav,pdf,epub,torrent,gguf,safetensors,bin,ckpt,pth');
    };
    window.addEventListener('ariazero_extensions_changed', handleUpdate);
    return () => window.removeEventListener('ariazero_extensions_changed', handleUpdate);
  }, []);

  const downloadRegex = useMemo(() => {
    const extList = extensions.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const escaped = extList.map(ext => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp(`(https?:\\/\\/[^\\s]+\\.(${escaped})([?#][^\\s]*)?|magnet:\\?xt=urn:[^\\s]+)`, 'gi');
  }, [extensions]);

  // Stable callback ref so listeners always see the latest function.
  const onLinkDetectedRef = useRef(onLinkDetected);
  const onTorrentDetectedRef = useRef(onTorrentDetected);
  useEffect(() => {
    onLinkDetectedRef.current = onLinkDetected;
    onTorrentDetectedRef.current = onTorrentDetected;
  }, [onLinkDetected, onTorrentDetected]);

  // -----------------------------------------------------------------------
  // Helper: emit a detected URL (deduplicates against the last one)
  // -----------------------------------------------------------------------
  const emitUrl = useCallback((url: string, source?: 'url_param' | 'clipboard' | 'drag') => {
    const trimmed = url.trim();
    if (!trimmed || trimmed === lastDetectedRef.current) return;
    lastDetectedRef.current = trimmed;
    onLinkDetectedRef.current(trimmed, source);
  }, []);

  const lastClipboardTextRef = useRef<string>('');

  // -----------------------------------------------------------------------
  // Helper: read clipboard and emit any detected URL
  // -----------------------------------------------------------------------
  const readClipboardAndEmit = useCallback(async (source: 'clipboard' = 'clipboard') => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim() !== lastClipboardTextRef.current) {
        lastClipboardTextRef.current = text.trim();
        const urls = extractUrls(text, downloadRegex);
        if (urls.length > 0) {
          emitUrl(urls[0], source);
        }
      }
    } catch {
      // Clipboard read requires permission and may fail silently.
    }
  }, [emitUrl, downloadRegex]);

  // -----------------------------------------------------------------------
  // 1. Clipboard Auto-Detect on window focus
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleFocus = () => {
      readClipboardAndEmit('clipboard');
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [readClipboardAndEmit]);

  // -----------------------------------------------------------------------
  // 2. Magnet URI Protocol Handler
  // -----------------------------------------------------------------------
  useEffect(() => {
    // Try to register as magnet: protocol handler
    try {
      navigator.registerProtocolHandler(
        'magnet',
        window.location.origin + '/?uri=%s'
      );
    } catch {
      // Registration may not be supported or allowed.
    }

    // Check for a uri= search parameter on mount
    const params = new URLSearchParams(window.location.search);
    const uri = params.get('uri');
    if (uri) {
      const decoded = decodeURIComponent(uri);
      emitUrl(decoded, 'url_param');
      // Clean the URL so the parameter is not re-processed on refresh.
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [emitUrl]);

  // -----------------------------------------------------------------------
  // 3. Drag & Drop
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      // Check for files (e.g. .torrent files)
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.name.endsWith('.torrent') && onTorrentDetectedRef.current) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const result = event.target?.result as string;
              if (result) {
                const base64Data = result.split(',')[1];
                if (base64Data) {
                  onTorrentDetectedRef.current!(base64Data, file.name);
                }
              }
            };
            reader.readAsDataURL(file);
          }
        }
      }

      const uriList = e.dataTransfer?.getData('text/uri-list');
      const plainText = e.dataTransfer?.getData('text/plain');
      const raw = uriList || plainText || '';

      const urls = extractUrls(raw, downloadRegex);
      for (const url of urls) {
        emitUrl(url, 'drag');
      }
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [emitUrl, downloadRegex]);

  // -----------------------------------------------------------------------
  // 4. Keyboard Shortcut (Ctrl/Cmd + V outside inputs)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isV = e.key === 'v' || e.key === 'V';
      const isMod = e.ctrlKey || e.metaKey;

      if (isV && isMod && !isInputElement(e.target)) {
        readClipboardAndEmit('clipboard');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [readClipboardAndEmit]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <SmartDownloadContext.Provider value={{ isDragging }}>
      {children}
    </SmartDownloadContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSmartDownload(): SmartDownloadContextValue {
  return useContext(SmartDownloadContext);
}
