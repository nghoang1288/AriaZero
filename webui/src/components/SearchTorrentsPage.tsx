import React, { useState, useEffect, useCallback } from 'react';
import { Search, Flame, Film, Tv, Gamepad, ShieldAlert, ArrowDown, ExternalLink } from 'lucide-react';
import { formatBytes } from '../useAria2';
import { useApiUrl } from '../hooks/useApiUrl';
import type { ToastMessage } from '../Toast';

interface SearchTorrentsPageProps {
  addUri: (uri: string, options?: Record<string, string>) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

interface TorrentResult {
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  magnetUri: string;
  infoUrl: string;
  tracker: string;
  publishDate: string;
  category: string;
  // OMDb metadata (optional, only for movies/TV)
  genre?: string;
  rtScore?: string;
  plot?: string;
  poster?: string;
}

interface JackettStatus {
  running: boolean;
  message?: string;
  configuredIndexers?: number;
  totalIndexers?: number;
}

export default function SearchTorrentsPage({ addUri, showToast }: SearchTorrentsPageProps) {
  const { getApiUrl } = useApiUrl();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TorrentResult[]>([]);
  const [sortField, setSortField] = useState<'seeders' | 'size' | 'none'>('seeders');
  
  // Jackett & Trending state
  const [jackettStatus, setJackettStatus] = useState<JackettStatus | null>(null);
  const [trendingMovies, setTrendingMovies] = useState<TorrentResult[]>([]);
  const [trendingTV, setTrendingTV] = useState<TorrentResult[]>([]);
  const [trendingGames, setTrendingGames] = useState<TorrentResult[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(false);

  // Helper to fetch authorization header
  const getHeaders = useCallback(() => {
    const secret = (window as any).AriaZeroServerConfig?.rpcSecret || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }
    const userOmdbKey = localStorage.getItem('ariazero_omdb_api_key');
    if (userOmdbKey) {
      headers['X-OMDb-API-Key'] = userOmdbKey;
    }
    return headers;
  }, []);

  // Fetch Jackett status
  const checkJackettStatus = useCallback(async () => {
    try {
      const url = getApiUrl('jackett-status');
      const res = await fetch(url, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setJackettStatus(data);
        return data.running;
      }
    } catch (e) {
      console.error('Failed to check Jackett status:', e);
    }
    return false;
  }, [getApiUrl, getHeaders]);

  // Fetch trending torrents for a specific category
  const fetchTrendingCategory = useCallback(async (cat: string) => {
    try {
      const url = `${getApiUrl('trending')}?cat=${cat}`;
      const res = await fetch(url, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        return data.results || [];
      }
    } catch (e) {
      console.error(`Failed to fetch trending for ${cat}:`, e);
    }
    return [];
  }, [getApiUrl, getHeaders]);

  // Load trending data
  const loadTrendingData = useCallback(async () => {
    setIsLoadingTrending(true);
    const [movies, tv, games] = await Promise.all([
      fetchTrendingCategory('movies'),
      fetchTrendingCategory('tv'),
      fetchTrendingCategory('games')
    ]);
    setTrendingMovies(movies.slice(0, 30));
    setTrendingTV(tv.slice(0, 30));
    setTrendingGames(games.slice(0, 30));
    setIsLoadingTrending(false);
  }, [fetchTrendingCategory]);

  useEffect(() => {
    const init = async () => {
      const isRunning = await checkJackettStatus();
      if (isRunning) {
        loadTrendingData();
      }
    };
    init();
  }, [checkJackettStatus, loadTrendingData]);

  // Refresh trending data when Settings change (e.g. OMDb API Key updated)
  useEffect(() => {
    const handleSettingsChanged = () => {
      loadTrendingData();
    };
    window.addEventListener('ariazero_settings_changed', handleSettingsChanged);
    return () => {
      window.removeEventListener('ariazero_settings_changed', handleSettingsChanged);
    };
  }, [loadTrendingData]);

  // Perform search
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const categoryParam = activeCategory !== 'all' ? `&cat=${getCategoryCode(activeCategory)}` : '';
      const url = `${getApiUrl('search')}?q=${encodeURIComponent(query.trim())}${categoryParam}`;
      const res = await fetch(url, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
         if (data.error) {
          showToast({ title: 'Search Error', message: data.error, type: 'error' });
          setSearchResults([]);
        } else {
          setSearchResults(data.results || []);
        }
      } else {
        showToast({ title: 'Search Error', message: 'Search request failed', type: 'error' });
      }
    } catch (err) {
      console.error('Search failed:', err);
      showToast({ title: 'Search Connection Error', message: 'Connection to search server failed', type: 'error' });
    } finally {
      setIsSearching(false);
    }
  };

  const getCategoryCode = (cat: string) => {
    switch (cat) {
      case 'movies': return '2000';
      case 'tv': return '5000';
      case 'games': return '4000';
      case 'music': return '3000';
      default: return '';
    }
  };

  // Trigger search on category change if query exists
  useEffect(() => {
    if (query.trim()) {
      handleSearch();
    }
  }, [activeCategory]);

  // Sort and process results
  const sortedResults = React.useMemo(() => {
    const list = [...searchResults];
    if (sortField === 'seeders') {
      list.sort((a, b) => b.seeders - a.seeders);
    } else if (sortField === 'size') {
      list.sort((a, b) => b.size - a.size);
    }
    return list;
  }, [searchResults, sortField]);

  const getCategoryNameForDownload = () => {
    if (activeCategory === 'movies') return 'Popular Movies';
    if (activeCategory === 'tv') return 'TV Series';
    if (activeCategory === 'games') return 'Trending Games';
    return undefined;
  };

  // Trigger download helper
  const handleDownload = (magnetUri: string, title: string, category?: string) => {
    if (!magnetUri) {
      showToast({ title: 'Download Error', message: 'No download link (magnet URI) found for this torrent', type: 'error' });
      return;
    }
    
    const options: Record<string, string> = {};
    if (category === 'Popular Movies') {
      options.dir = '/downloads/Movies';
    } else if (category === 'TV Series') {
      options.dir = '/downloads/TV Series';
    } else if (category === 'Trending Games') {
      options.dir = '/downloads/Games';
    }
    
    addUri(magnetUri, Object.keys(options).length > 0 ? options : undefined);
    showToast({ title: 'Download Started', message: `Downloading: ${title.slice(0, 40)}...`, type: 'success' });
  };

  const formatAge = (pubDateStr: string) => {
    if (!pubDateStr) return '';
    try {
      const pubDate = new Date(pubDateStr);
      const diffMs = new Date().getTime() - pubDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays > 365) return `${Math.floor(diffDays / 365)} years ago`;
      if (diffDays > 30) return `${Math.floor(diffDays / 30)} months ago`;
      return `${diffDays} days ago`;
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-12">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-main pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-main flex items-center gap-2">
            <Search className="w-5 h-5 text-cyan-400" />
            Torrent Search Aggregator
          </h1>
          <p className="text-xs text-text-dim mt-1">
            Search and index files across multiple public torrent sources using Jackett.
          </p>
        </div>

        {/* Jackett Dashboard Link */}
        <a 
          href="/jackett/" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-page-bg hover:bg-page-bg/80 text-text-main border border-border-main transition-all cursor-pointer self-start md:self-auto"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Jackett Dashboard
        </a>
      </div>

      {/* Warning if Jackett is not running or has no indexers */}
      {jackettStatus && !jackettStatus.running && (
        <div className="flex items-start gap-4 p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-sm">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-semibold text-text-main">Jackett connection issue</p>
            <p className="text-text-dim text-xs leading-relaxed">
              {jackettStatus.message || "Jackett search service is not currently running or cannot be contacted."}
            </p>
            <div className="flex gap-3 pt-1">
              <a 
                href="/jackett/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/20 transition-all cursor-pointer"
              >
                Configure Jackett Service
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main Search Input & Category Filters */}
      {jackettStatus?.running && (
        <div className="space-y-4">
          <form onSubmit={handleSearch} className="flex gap-2 max-w-3xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 w-4 h-4 text-text-dim" />
              <input
                type="text"
                placeholder="Search torrents by name (e.g. Ubuntu, Toy Story...)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-sidebar-bg/60 border border-border-main rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-main focus:outline-none focus:border-cyan-500 transition-all placeholder:text-text-dim/60 font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-cyan-500 hover:bg-cyan-600 text-black shadow-lg shadow-cyan-500/10 transition-all font-bold cursor-pointer disabled:opacity-50"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {/* Category Chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[
              { id: 'all', label: 'All Torrents' },
              { id: 'movies', label: 'Movies' },
              { id: 'tv', label: 'TV Shows' },
              { id: 'games', label: 'Games' },
              { id: 'music', label: 'Music' }
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  activeCategory === cat.id
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                    : 'bg-page-bg/40 text-text-dim border-border-main hover:text-text-main hover:border-text-dim'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading States */}
      {isSearching && (
        <div className="py-16 text-center space-y-3">
          <div className="inline-block w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-text-dim font-medium">Querying indexed trackers. Please wait...</p>
        </div>
      )}

      {/* Search Results Table */}
      {!isSearching && query.trim() !== '' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-text-main flex items-center gap-2">
              Found {searchResults.length} results
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Sort by:</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as any)}
                className="bg-sidebar-bg border border-border-main text-xs text-text-main rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
              >
                <option value="seeders">Seeders</option>
                <option value="size">Size</option>
              </select>
            </div>
          </div>

          {sortedResults.length > 0 ? (
            <div className="overflow-x-auto border border-border-main rounded-xl bg-sidebar-bg/25">
              <table className="w-full border-collapse text-left text-xs text-text-main">
                <thead>
                  <tr className="border-b border-border-main bg-page-bg/20 font-semibold text-text-dim">
                    <th className="p-4 w-3/5">Torrent Title</th>
                    <th className="p-4 text-center">Size</th>
                    <th className="p-4 text-center">S / L</th>
                    <th className="p-4 text-center">Source</th>
                    <th className="p-4 text-center">Age</th>
                    <th className="p-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-main/50">
                  {sortedResults.map((item, idx) => (
                    <tr key={idx} className="hover:bg-page-bg/10 transition-colors">
                      <td className="p-4 font-medium leading-relaxed">
                        {item.infoUrl ? (
                          <a
                            href={item.infoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-cyan-400 hover:underline transition-colors block break-all"
                          >
                            {item.title}
                          </a>
                        ) : (
                          <span className="block break-all">{item.title}</span>
                        )}
                      </td>
                      <td className="p-4 text-center font-mono font-medium text-text-dim shrink-0">
                        {formatBytes(item.size)}
                      </td>
                      <td className="p-4 text-center font-mono">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-emerald-400 font-semibold">{item.seeders}</span>
                          <span className="text-text-dim">/</span>
                          <span className="text-red-400">{item.leechers}</span>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/10 uppercase">
                          {item.tracker}
                        </span>
                      </td>
                      <td className="p-4 text-center text-text-dim font-medium whitespace-nowrap">
                        {formatAge(item.publishDate)}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleDownload(item.magnetUri, item.title, getCategoryNameForDownload())}
                          disabled={!item.magnetUri}
                          title={item.magnetUri ? "Download Torrent" : "Download URL not found"}
                          className="p-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500 text-cyan-400 hover:text-black border border-cyan-500/20 hover:border-transparent transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 border border-dashed border-border-main rounded-xl text-center">
              <p className="text-sm text-text-dim">No results found matching your search. Try adjusting the query.</p>
            </div>
          )}
        </div>
      )}

      {/* Trending Suggestions / Top 100 */}
      {jackettStatus?.running && query.trim() === '' && (
        <div className="space-y-8">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-text-main tracking-tight">
              Trending & Top Seeded Torrents
            </h2>
            <span className="bg-amber-500/10 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/10 font-mono">
              Top 30
            </span>
          </div>

          {isLoadingTrending ? (
            <div className="py-12 text-center space-y-2">
              <div className="inline-block w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs text-text-dim font-medium">Fetching trending data...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Movies Section */}
              <TrendingSection
                title="Popular Movies"
                icon={<Film className="w-4 h-4 text-cyan-400" />}
                items={trendingMovies}
                onDownload={handleDownload}
              />

              {/* TV Shows Section */}
              <TrendingSection
                title="TV Series"
                icon={<Tv className="w-4 h-4 text-purple-400" />}
                items={trendingTV}
                onDownload={handleDownload}
              />

              {/* Games Section */}
              <TrendingSection
                title="Trending Games"
                icon={<Gamepad className="w-4 h-4 text-emerald-400" />}
                items={trendingGames}
                onDownload={handleDownload}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TrendingSectionProps {
  title: string;
  icon: React.ReactNode;
  items: TorrentResult[];
  onDownload: (magnetUri: string, title: string, category?: string) => void;
}

function getRtScoreColor(score: string): string {
  const isImdb = score.startsWith('IMDb:');
  const valStr = isImdb ? score.substring(5) : score;
  const num = isImdb ? parseFloat(valStr) * 10 : parseInt(valStr);
  if (isNaN(num)) return 'text-text-dim';
  if (num >= 75) return 'text-emerald-400';
  if (num >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function getRtBgColor(score: string): string {
  const isImdb = score.startsWith('IMDb:');
  const valStr = isImdb ? score.substring(5) : score;
  const num = isImdb ? parseFloat(valStr) * 10 : parseInt(valStr);
  if (isNaN(num)) return 'bg-white/5';
  if (num >= 75) return 'bg-emerald-500/10 border-emerald-500/20';
  if (num >= 60) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

function TrendingSection({ title, icon, items, onDownload }: TrendingSectionProps) {
  return (
    <div className="flex flex-col border border-border-main rounded-xl bg-sidebar-bg/15 overflow-hidden">
      <div className="flex items-center gap-2 p-4 bg-page-bg/25 border-b border-border-main font-bold text-text-main text-sm">
        {icon}
        {title}
      </div>

      <div className="flex-1 divide-y divide-border-main/40 overflow-y-auto max-h-[850px]">
        {items.length > 0 ? (
          items.map((item, idx) => (
            <div key={idx} className="group relative p-3.5 hover:bg-page-bg/10 transition-colors flex items-start gap-3">
              {/* Poster Thumbnail */}
              {item.poster ? (
                <img
                  src={item.poster}
                  alt=""
                  className="w-10 h-14 rounded-md object-cover shrink-0 border border-border-main/30 shadow-sm bg-page-bg/30"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-10 h-14 rounded-md bg-page-bg/40 border border-border-main/20 shrink-0 flex items-center justify-center">
                  <Film className="w-4 h-4 text-text-dim/30" />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-1.5">
                {/* Title with hover tooltip */}
                <div className="relative">
                  <span className="block text-xs font-semibold text-text-main hover:text-cyan-400 leading-relaxed line-clamp-2 cursor-pointer">
                    {item.infoUrl ? (
                      <a href={item.infoUrl} target="_blank" rel="noopener noreferrer">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </span>
                  {/* Plot tooltip on hover */}
                  {item.plot && (
                    <div className="absolute left-0 top-full mt-2 w-72 p-3 bg-[#0c1520] border border-border-main rounded-xl shadow-2xl shadow-black/40 text-[11px] leading-relaxed text-text-dim z-50 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 backdrop-blur-sm">
                      <div className="text-[10px] font-bold text-cyan-400 mb-1 uppercase tracking-wider">Synopsis</div>
                      {item.plot}
                      <div className="absolute left-4 -top-1.5 w-3 h-3 bg-[#0c1520] border-l border-t border-border-main rotate-45"></div>
                    </div>
                  )}
                </div>

                {/* Genre + RT Score row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {item.genre && item.genre.split(',').slice(0, 3).map((g, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-cyan-500/8 text-cyan-300/80 border border-cyan-500/10">
                      {g.trim()}
                    </span>
                  ))}
                  {item.rtScore && (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border flex items-center gap-1 ${getRtBgColor(item.rtScore)}`}>
                      <span className="text-[10px]">{item.rtScore.startsWith('IMDb:') ? '⭐' : '🍅'}</span>
                      <span className={getRtScoreColor(item.rtScore)}>
                        {item.rtScore.startsWith('IMDb:') ? item.rtScore.substring(5) : item.rtScore}
                      </span>
                    </span>
                  )}
                </div>

                {/* Size / Seeds / Tracker */}
                <div className="flex items-center gap-2 text-[10px] text-text-dim font-medium">
                  <span className="font-mono">{formatBytes(item.size)}</span>
                  <span className="text-border-main">•</span>
                  <span className="flex items-center gap-1 font-mono">
                    <span className="text-emerald-400 font-semibold">{item.seeders}</span> seeds
                  </span>
                  <span className="text-border-main">•</span>
                  <span className="bg-page-bg/50 px-1.5 py-0.5 rounded text-[9px] font-bold text-text-main border border-border-main/30 uppercase font-sans">
                    {item.tracker}
                  </span>
                </div>
              </div>

              {/* Download button */}
              <button
                onClick={() => onDownload(item.magnetUri, item.title)}
                disabled={!item.magnetUri}
                title={item.magnetUri ? "Download" : "No link"}
                className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500 text-cyan-400 hover:text-black border border-cyan-500/20 hover:border-transparent transition-all cursor-pointer self-center shrink-0"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        ) : (
          <div className="py-12 text-center text-xs text-text-dim font-medium">
            No trending data available.
          </div>
        )}
      </div>
    </div>
  );
}
