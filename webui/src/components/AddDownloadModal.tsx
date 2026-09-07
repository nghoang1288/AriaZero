import React, { useState, useEffect, useMemo } from 'react';
import { X, Upload, Clipboard, HardDrive } from 'lucide-react';
import { isGoogleDriveUrl, parseDownloadUrls } from '../utils/taskUtils';

interface AddDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (mode: 'link' | 'torrent', uris: string, torrentFile: { name: string; base64: string } | null) => void;
  initialUris?: string;
  initialMode?: 'link' | 'torrent';
}

export default function AddDownloadModal({ 
  isOpen, 
  onClose, 
  onSubmit,
  initialUris = '',
  initialMode = 'link',
}: AddDownloadModalProps) {
  const [addMode, setAddMode] = useState<'link' | 'torrent'>(initialMode);
  const [newUris, setNewUris] = useState(initialUris);
  const [torrentFile, setTorrentFile] = useState<{ name: string; base64: string } | null>(null);

  const [extractedUrls, setExtractedUrls] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Record<string, boolean>>({});
  const [showBatchSelection, setShowBatchSelection] = useState(false);

  // Sync initial values when modal opens & auto-check clipboard if empty
  useEffect(() => {
    if (isOpen) {
      setAddMode(initialMode);
      setTorrentFile(null);
      setExtractedUrls([]);
      setSelectedUrls({});
      setShowBatchSelection(false);

      if (initialUris) {
        setNewUris(initialUris);
      } else {
        setNewUris('');
        // Auto-check clipboard on modal open
        if (navigator?.clipboard?.readText) {
          navigator.clipboard.readText().then((text) => {
            if (text) {
              const trimmed = text.trim();
              const urls = parseDownloadUrls(trimmed);
              if (urls.length > 0) {
                setNewUris(urls.join('\n'));
              }
            }
          }).catch(() => {
            // Silently ignore clipboard permission errors
          });
        }
      }
    }
  }, [isOpen, initialMode, initialUris]);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const trimmed = text.trim();
        const urls = parseDownloadUrls(trimmed);
        if (urls.length > 0) {
          setNewUris((prev) => (prev ? `${prev}\n${urls.join('\n')}` : urls.join('\n')));
        } else {
          setNewUris((prev) => (prev ? `${prev}\n${trimmed}` : trimmed));
        }
      }
    } catch {
      // Ignore
    }
  };

  const hasGoogleDrive = useMemo(() => isGoogleDriveUrl(newUris), [newUris]);
  const parsedUrlsCount = useMemo(() => parseDownloadUrls(newUris).length, [newUris]);

  if (!isOpen) return null;

  const extractUrls = () => {
    const unique = parseDownloadUrls(newUris);
    if (unique.length > 0) {
      setExtractedUrls(unique);
      const initialSelected: Record<string, boolean> = {};
      unique.forEach(url => {
        initialSelected[url] = true;
      });
      setSelectedUrls(initialSelected);
      if (unique.length > 1) {
        setShowBatchSelection(true);
      } else {
        setNewUris(unique[0]);
      }
    }
  };

  const handleModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (addMode === 'link') {
      if (showBatchSelection) {
        const finalUris = extractedUrls
          .filter(url => selectedUrls[url])
          .join('\n');
        if (!finalUris) return;
        onSubmit(addMode, finalUris, null);
      } else {
        const cleaned = parseDownloadUrls(newUris).join('\n');
        if (!cleaned) return;
        onSubmit(addMode, cleaned, torrentFile);
      }
    } else {
      onSubmit(addMode, newUris, torrentFile);
    }
    // Reset state
    setNewUris('');
    setTorrentFile(null);
    setExtractedUrls([]);
    setSelectedUrls({});
    setShowBatchSelection(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-sidebar-bg border border-border-main rounded-xl max-w-lg w-full overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-border-main flex items-center justify-between">
          <h3 className="text-md font-semibold text-text-main">Start New Download</h3>
          <button 
            onClick={() => {
              onClose();
              setTorrentFile(null);
            }}
            className="text-text-dim hover:text-text-main transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="flex border-b border-border-main text-xs font-semibold bg-page-bg/20">
          <button 
            type="button"
            onClick={() => setAddMode('link')}
            className={`flex-1 py-3 text-center border-b-2 transition-colors cursor-pointer ${
              addMode === 'link' ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5' : 'border-transparent text-text-dim hover:text-text-main'
            }`}
          >
            Links (HTTP/FTP/Magnet)
          </button>
          <button 
            type="button"
            onClick={() => setAddMode('torrent')}
            className={`flex-1 py-3 text-center border-b-2 transition-colors cursor-pointer ${
              addMode === 'torrent' ? 'border-cyan-400 text-cyan-400 bg-cyan-500/5' : 'border-transparent text-text-dim hover:text-text-main'
            }`}
          >
            Torrent File (.torrent)
          </button>
        </div>
        
        <form onSubmit={handleModalSubmit}>
          <div className="p-5 space-y-4">
            {addMode === 'link' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-text-dim block">URLs to download</label>
                  {parsedUrlsCount > 1 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-semibold border border-cyan-500/20">
                      Phát hiện {parsedUrlsCount} liên kết
                    </span>
                  )}
                </div>
                {!showBatchSelection ? (
                  <>
                    <textarea 
                      rows={4}
                      placeholder="Paste HTTP/HTTPS/FTP or Magnet links here (one per line, or a block of text)..."
                      value={newUris}
                      onChange={(e) => setNewUris(e.target.value)}
                      className="w-full bg-input-bg border border-border-main rounded-lg px-3 py-2 text-xs text-text-main placeholder-text-dim/60 focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <button
                        type="button"
                        onClick={handlePasteClipboard}
                        className="inline-flex items-center gap-1.5 text-text-dim hover:text-cyan-400 text-[11px] font-medium transition-colors cursor-pointer"
                        title="Dán nội dung từ bộ nhớ tạm (Clipboard)"
                      >
                        <Clipboard className="w-3.5 h-3.5" />
                        <span>Dán từ Clipboard</span>
                      </button>
                      <button
                        type="button"
                        onClick={extractUrls}
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 font-semibold text-[11px] px-3 py-1.5 rounded transition-colors cursor-pointer"
                      >
                        Parse Text for Links
                      </button>
                    </div>

                    {hasGoogleDrive && (
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs mt-3">
                        <HardDrive className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="font-semibold text-amber-400 block">Đã nhận diện link Google Drive</span>
                          <span className="text-[11px] text-amber-300/80 leading-relaxed block mt-0.5">
                            Hệ thống sẽ tự động giải mã tải trực tiếp và tự động xếp vào hàng chờ (Auto 24h Quota Retry) nếu bị quá giới hạn lượt tải!
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-text-dim">
                      <span>Extracted {extractedUrls.length} URLs:</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const updated: Record<string, boolean> = {};
                            extractedUrls.forEach(url => { updated[url] = true; });
                            setSelectedUrls(updated);
                          }}
                          className="text-cyan-400 hover:underline cursor-pointer"
                        >
                          Select All
                        </button>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() => {
                            const updated: Record<string, boolean> = {};
                            extractedUrls.forEach(url => { updated[url] = false; });
                            setSelectedUrls(updated);
                          }}
                          className="text-cyan-400 hover:underline cursor-pointer"
                        >
                          Select None
                        </button>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-border-main rounded-lg p-2.5 bg-input-bg space-y-2 divide-y divide-border-main/20">
                      {extractedUrls.map((url, idx) => (
                        <div key={idx} className="flex items-start gap-2 pt-2 first:pt-0">
                          <input
                            type="checkbox"
                            checked={!!selectedUrls[url]}
                            onChange={(e) => {
                              setSelectedUrls(prev => ({
                                ...prev,
                                [url]: e.target.checked
                              }));
                            }}
                            className="mt-0.5 rounded border-border-main bg-page-bg text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                          />
                          <span className="text-[11px] font-mono break-all text-text-main leading-tight">
                            {url}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setShowBatchSelection(false);
                          setNewUris(extractedUrls.filter(url => selectedUrls[url]).join('\n'));
                        }}
                        className="text-[11px] text-text-dim hover:text-text-main cursor-pointer"
                      >
                        ← Back to Raw Text
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs text-text-dim block mb-1.5">Upload .torrent file</label>
                <div 
                  className="border border-dashed border-border-main rounded-xl p-8 flex flex-col items-center justify-center gap-2.5 bg-page-bg/40 hover:bg-page-bg/85 hover:border-cyan-500/50 cursor-pointer transition-colors relative"
                  onClick={() => document.getElementById('torrent-input-picker')?.click()}
                >
                  <input 
                    id="torrent-input-picker"
                    type="file"
                    accept=".torrent"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const result = event.target?.result as string;
                          if (result) {
                            const base64 = result.split(',')[1];
                            if (base64) {
                              setTorrentFile({ name: file.name, base64 });
                            }
                          }
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <Upload className="w-8 h-8 text-text-dim" />
                  {torrentFile ? (
                    <div className="text-center">
                      <span className="text-xs font-semibold text-emerald-400 block max-w-[280px] truncate">{torrentFile.name}</span>
                      <span className="text-[10px] text-text-dim block mt-0.5">Click to choose another file</span>
                    </div>
                  ) : (
                    <div className="text-center">
                      <span className="text-xs font-semibold text-text-main block">Click to select torrent file</span>
                      <span className="text-[10px] text-text-dim block mt-0.5">Supports .torrent files</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="text-[11px] text-text-dim">
              Tasks will start immediately and save to the shared downloads directory.
            </div>
          </div>

          <div className="px-5 py-4 border-t border-border-main bg-page-bg/20 flex items-center justify-end gap-3">
            <button 
              type="button"
              onClick={() => {
                onClose();
                setTorrentFile(null);
              }}
              className="px-4 py-2 rounded-lg text-xs font-semibold hover:bg-page-bg/40 transition-colors text-text-dim cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={addMode === 'torrent' && !torrentFile}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:from-slate-600 disabled:to-slate-700 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Start Download
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
