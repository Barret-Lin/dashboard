/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Crosshair, TrendingDown, Globe, RefreshCw, AlertTriangle, ExternalLink, Activity, Radar, Clock, Flame, Key, Trash2, Plus, Lock, Unlock, Copy, Check } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { fetchIntelligence, fetchOverallThreatLevel, IntelligenceData, checkApiKeyStatus, getAllKeysStatus, KeyStatus, ThreatLevelData, getFallbackKeys, saveFallbackKeys, keyUsageStats, getRpmCount } from './services/intelligenceService';

const CATEGORIES = [
  { id: 'weekly_threat', name: '本日最新威脅情資', icon: Flame, query: '綜合威脅情資、重大事件總結' },
  { id: 'military', name: '軍事動態', icon: Crosshair, query: '軍事演習、軍機繞台、軍艦活動、飛彈試射' },
  { id: 'economic', name: '經濟封鎖', icon: TrendingDown, query: '經濟制裁、禁止進口、關稅壁壘、貿易壁壘' },
  { id: 'diplomatic', name: '外交打壓', icon: Globe, query: '斷交、國際組織參與受阻、施壓他國' },
  { id: 'cognitive', name: '認知作戰', icon: AlertTriangle, query: '假訊息、官媒恐嚇、網路攻擊、認知作戰' },
];

function getNextQuotaResetTime() {
  const now = new Date();
  const ptDateStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const ptDate = new Date(ptDateStr);
  const ptMidnight = new Date(ptDate);
  ptMidnight.setHours(24, 0, 0, 0);
  const diff = ptMidnight.getTime() - ptDate.getTime();
  return new Date(now.getTime() + diff);
}

const THREAT_COLORS: Record<string, string> = {
  'CRITICAL': 'text-red-500 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]',
  'HIGH': 'text-orange-500 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.5)]',
  'ELEVATED': 'text-yellow-500 border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.5)]',
  'GUARDED': 'text-blue-500 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]',
  'LOW': 'text-green-500 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]',
};

const getScoreStyle = (score: number) => {
  const base = 'text-[1.5em] font-bold';
  if (score >= 85) return `${base} text-red-500 bg-red-500/20 px-1.5 py-0.5 rounded`;
  if (score >= 65) return `${base} text-yellow-500`;
  return base;
};

function CopyableMarkdownLink({ href, children, ...props }: any) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (href) {
      navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <a href={href} {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
        {children}
      </a>
      {href && (
        <button
          onClick={handleCopy}
          className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors inline-flex items-center justify-center"
          title="複製連結"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </span>
  );
}

function CopyableSourceCard({ source }: { source: { title: string; uri: string } }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(source.uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <a 
        href={source.uri} 
        target="_blank" 
        rel="noopener noreferrer"
        className="block p-3 bg-[#111] tech-border hover:border-zinc-600 hover:bg-[#1a1a1a] transition-colors pr-12"
      >
        <p className="text-sm text-zinc-300 truncate group-hover:text-zinc-100">{source.title}</p>
        <p className="text-xs text-zinc-500 truncate mt-1 font-mono">{source.uri}</p>
      </a>
      <button
        onClick={handleCopy}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        title="複製連結"
      >
        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

function RpmStatus() {
  const [rpmCount, setRpmCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRpmCount(getRpmCount());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`font-mono text-xs px-2 py-0.5 rounded border flex items-center gap-1.5 ${rpmCount >= 15 ? 'bg-red-500/20 border-red-500/50 text-red-500' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
      <Activity className="w-3 h-3" />
      RPM: {rpmCount}/15
    </div>
  );
}

function RpmWarning() {
  const [rpmCount, setRpmCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRpmCount(getRpmCount());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AnimatePresence>
      {rpmCount >= 15 && (
        <motion.div
          initial={{ opacity: 0, y: -10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -10, height: 0 }}
          className="overflow-hidden"
        >
          <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-3 rounded-lg font-mono text-sm flex items-center gap-3 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            <span><strong>每分鐘頻率限制 (RPM)：</strong>每分鐘最多 15 次，請稍後再試。</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState(CATEGORIES[0].id);
  const [intelligence, setIntelligence] = useState<Record<string, IntelligenceData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [threatLevel, setThreatLevel] = useState<ThreatLevelData | null>(null);
  const [threatLoading, setThreatLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [categoryUpdated, setCategoryUpdated] = useState<Record<string, Date>>({});
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showThreatDetails, setShowThreatDetails] = useState(false);

  const [customApiKey, setCustomApiKey] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyModalReason, setApiKeyModalReason] = useState<'RATE_LIMIT' | 'MANUAL'>('RATE_LIMIT');

  const [showKeyStatusModal, setShowKeyStatusModal] = useState(false);
  const [keyStatuses, setKeyStatuses] = useState<KeyStatus[]>([]);
  const [checkingKeys, setCheckingKeys] = useState(false);
  const [tempKeyStatus, setTempKeyStatus] = useState<'VALID' | 'RATE_LIMITED' | 'INVALID' | 'UNKNOWN' | null>(null);
  const [testingTempKey, setTestingTempKey] = useState(false);

  const [isAdminMode, setIsAdminMode] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [newFallbackKey, setNewFallbackKey] = useState('');

  const handleCheckAllKeys = async () => {
    setCheckingKeys(true);
    try {
      const statuses = await getAllKeysStatus();
      setKeyStatuses(statuses);
    } catch (e) {
      console.error(e);
    } finally {
      setCheckingKeys(false);
    }
  };

  const handleTestTempKey = async () => {
    if (!tempApiKey.trim()) return;
    setTestingTempKey(true);
    setTempKeyStatus(null);
    try {
      const status = await checkApiKeyStatus(tempApiKey.trim());
      setTempKeyStatus(status);
    } catch (e) {
      console.error(e);
    } finally {
      setTestingTempKey(false);
    }
  };

  const loadThreatLevel = async (keyOverride?: string, force = false) => {
    setThreatLoading(true);
    try {
      const data = await fetchOverallThreatLevel(keyOverride ?? customApiKey, force);
      if (data.isRateLimited) {
        setApiKeyModalReason('RATE_LIMIT');
        setShowApiKeyInput(true);
        setThreatLevel(prev => prev ? prev : data);
      } else {
        setThreatLevel(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setThreatLoading(false);
    }
  };

  const loadIntelligence = async (categoryId: string, force = false, keyOverride?: string) => {
    if (!force && intelligence[categoryId]) return;
    
    setLoading(prev => ({ ...prev, [categoryId]: true }));
    try {
      const category = CATEGORIES.find(c => c.id === categoryId);
      if (category) {
        const data = await fetchIntelligence(category.id, category.query, keyOverride ?? customApiKey, force);
        if (data.isRateLimited) {
          setApiKeyModalReason('RATE_LIMIT');
          setShowApiKeyInput(true);
          setIntelligence(prev => prev[categoryId] ? prev : { ...prev, [categoryId]: data });
        } else {
          setIntelligence(prev => ({ ...prev, [categoryId]: data }));
          setLastUpdated(new Date());
          setCategoryUpdated(prev => ({ ...prev, [categoryId]: new Date() }));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(prev => ({ ...prev, [categoryId]: false }));
    }
  };

  useEffect(() => {
    loadThreatLevel();
    // loadIntelligence is handled by the activeTab dependency effect below
  }, []);

  useEffect(() => {
    loadIntelligence(activeTab);
  }, [activeTab]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(() => {
        handleRefreshAll();
      }, 6 * 60 * 60 * 1000); // 6 hours
    }
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, customApiKey]);

  const handleRefreshAll = (keyOverride?: string) => {
    const keyToUse = typeof keyOverride === 'string' ? keyOverride : customApiKey;
    loadThreatLevel(keyToUse, true);
    loadIntelligence(activeTab, true, keyToUse);
  };

  const activeData = intelligence[activeTab];
  const isLoading = loading[activeTab];

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-300 font-sans selection:bg-red-500/30 p-4 md:p-8 scanline-bg">
      <div className="max-w-7xl mx-auto space-y-6 relative z-10">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-100 uppercase font-mono">台海戰情即時情報網</h1>
            </div>
            <div className="flex items-center gap-4">
              <p className="text-zinc-500 font-mono text-sm flex items-center gap-2">
                <Clock className="w-4 h-4" />
                SYS.TIME: {lastUpdated ? lastUpdated.toLocaleTimeString() : '--:--:--'}
              </p>
              <RpmStatus />
            </div>
          </div>

          {/* Threat Level Indicator */}
          <div className="flex flex-wrap items-center gap-4 bg-[#0a0a0a] p-4 tech-border">
            <div className="flex flex-col">
              <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">Overall Threat Level</span>
              {threatLoading ? (
                <div className="h-6 w-24 bg-zinc-800 animate-pulse rounded"></div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className={`px-3 py-1 rounded border font-mono font-bold text-sm tracking-widest ${THREAT_COLORS[threatLevel?.level || 'ELEVATED'] || THREAT_COLORS['ELEVATED']}`}>
                    {threatLevel?.level || 'UNKNOWN'}
                  </div>
                </div>
              )}
            </div>
            <div className="hidden lg:block w-px h-10 bg-zinc-800 mx-2"></div>
            <div className="flex-1 w-full lg:w-auto lg:max-w-md order-last lg:order-none mt-2 lg:mt-0">
              {threatLoading ? (
                <div className="h-4 w-full bg-zinc-800 animate-pulse rounded"></div>
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-zinc-400 line-clamp-2">{threatLevel?.summary || '系統初始化中...'}</p>
                  {threatLevel?.sources && threatLevel.sources.length > 0 && (
                    <div className="flex items-center gap-2 mt-1 overflow-x-auto pb-1 no-scrollbar">
                      <span className="text-[10px] text-zinc-500 uppercase font-mono shrink-0">Sources:</span>
                      {threatLevel.sources.slice(0, 3).map((s, i) => (
                        <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 truncate max-w-[100px] border border-blue-900/50 bg-blue-900/20 px-1.5 py-0.5 rounded shrink-0">
                          {s.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {threatLevel?.totalScore !== undefined && (
                <button
                  onClick={() => setShowThreatDetails(true)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-mono rounded-lg border border-zinc-700 transition-colors flex items-center gap-2"
                >
                  <span className="hidden sm:inline">SCORE:</span> 
                  <span className={getScoreStyle(threatLevel.totalScore)}>{threatLevel.totalScore}</span>
                  <Activity className="w-3 h-3 text-zinc-400" />
                </button>
              )}
              <button 
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-2 rounded-full transition-colors ${autoRefresh ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'hover:bg-zinc-800 text-zinc-400'}`}
                title={autoRefresh ? "Disable Auto Refresh" : "Enable Auto Refresh (6h)"}
              >
                <Clock className={`w-5 h-5 ${autoRefresh ? 'animate-pulse' : ''}`} />
              </button>
              <button 
                onClick={() => handleRefreshAll()}
                disabled={threatLoading || isLoading}
                className="p-2 hover:bg-zinc-800 rounded-full transition-colors disabled:opacity-50"
                title="立即更新 (Refresh Intelligence)"
              >
                <RefreshCw className={`w-5 h-5 text-zinc-400 ${threatLoading || isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button 
                onClick={() => {
                  setTempApiKey(customApiKey);
                  setApiKeyModalReason('MANUAL');
                  setShowApiKeyInput(true);
                }}
                className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                title="更換 API 金鑰"
              >
                <Key className="w-5 h-5 text-zinc-400" />
              </button>
              <button 
                onClick={() => {
                  setShowKeyStatusModal(true);
                  handleCheckAllKeys();
                }}
                className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                title="API Key Status"
              >
                <Activity className="w-5 h-5 text-zinc-400" />
              </button>
            </div>
          </div>
        </header>

        <RpmWarning />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Sidebar Navigation */}
          <div className="lg:col-span-3 flex flex-col gap-2">
            <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2 lg:mb-4 px-2 hidden lg:block">Intelligence Feeds</div>
            <div className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 no-scrollbar">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeTab === cat.id;
                const updatedTime = categoryUpdated[cat.id];
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveTab(cat.id)}
                    className={`shrink-0 lg:w-full flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 px-4 py-3 text-left transition-all duration-200 font-mono text-sm uppercase ${
                      isActive 
                        ? 'bg-[#1a1a1a] text-zinc-100 tech-border border-l-2 border-l-red-500' 
                        : 'text-zinc-500 hover:bg-[#0f0f0f] hover:text-zinc-300 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`w-5 h-5 ${isActive ? 'text-red-500' : ''}`} />
                      <span className="font-medium whitespace-nowrap">{cat.name}</span>
                    </div>
                    
                    <div className="flex items-center justify-between w-full lg:w-auto lg:ml-auto gap-2">
                      {updatedTime && (
                        <span className="text-[10px] font-mono text-zinc-500 whitespace-nowrap">
                          {updatedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {loading[cat.id] && <Activity className="w-4 h-4 animate-pulse text-zinc-500" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-9">
            <div className="bg-[#0a0a0a] tech-border relative min-h-[500px] flex flex-col z-10">
              
              {/* Top Bar of the Terminal */}
              <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                  <span className="font-mono text-xs text-zinc-500">INTEL_FEED // {CATEGORIES.find(c => c.id === activeTab)?.name.toUpperCase()}</span>
                </div>
                <span className="font-mono text-xs text-zinc-600">CLASS: CONFIDENTIAL</span>
              </div>

              {/* Content */}
              <div className="p-6 flex-1 relative">
                <h3 className="text-xl font-mono font-bold text-zinc-100 mb-4 border-b border-zinc-800 pb-2 flex items-center gap-2">
                  <Radar className="w-5 h-5 text-red-500" />
                  INTEL_FEED // {CATEGORIES.find(c => c.id === activeTab)?.id.toUpperCase()}
                </h3>
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500"
                    >
                      <div className="relative w-24 h-24 mb-4">
                        <div className="absolute inset-0 border-2 border-zinc-800 rounded-full"></div>
                        <div className="absolute inset-0 border-2 border-t-red-500 rounded-full animate-spin"></div>
                        <Radar className="absolute inset-0 m-auto w-8 h-8 text-red-500/50 animate-pulse" />
                      </div>
                      <p className="font-mono text-sm animate-pulse">INTERCEPTING SIGNALS...</p>
                    </motion.div>
                  ) : activeData ? (
                    <motion.div
                      key="content"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex flex-col h-full"
                    >
                      <div className="markdown-body flex-1">
                        <Markdown
                          components={{
                            a: ({node, ...props}) => <CopyableMarkdownLink {...props} />
                          }}
                        >
                          {activeData.text}
                        </Markdown>
                      </div>

                      {/* Sources Section */}
                      {activeData.sources.length > 0 && (
                        <div className="mt-8 pt-6 border-t border-zinc-800">
                          <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <ExternalLink className="w-4 h-4" />
                            Verified Sources
                          </h4>
                          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {activeData.sources.map((source, idx) => (
                              <li key={idx}>
                                <CopyableSourceCard source={source} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-600 font-mono text-sm">
                      NO DATA AVAILABLE
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* API Key Input Modal */}
      <AnimatePresence>
        {showApiKeyInput && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`bg-[#0a0a0a] tech-border p-6 max-w-md w-full ${apiKeyModalReason === 'RATE_LIMIT' ? 'border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.2)]' : 'shadow-2xl'}`}
            >
              <div className={`flex items-center gap-3 mb-4 ${apiKeyModalReason === 'RATE_LIMIT' ? 'text-red-500' : 'text-zinc-100'}`}>
                {apiKeyModalReason === 'RATE_LIMIT' ? <AlertTriangle className="w-6 h-6" /> : <Key className="w-6 h-6" />}
                <h2 className="text-lg font-bold">{apiKeyModalReason === 'RATE_LIMIT' ? 'API 請求次數已達上限' : '設定自訂 API 金鑰'}</h2>
              </div>
              <p className="text-zinc-400 text-sm mb-6">
                {apiKeyModalReason === 'RATE_LIMIT' 
                  ? '內建的 API 金鑰已超出配額限制。請輸入您自己的 Gemini API 金鑰以繼續使用。此金鑰僅會保存在您當前的瀏覽器記憶體中，離開網頁後將自動清除。'
                  : '請輸入您自己的 Gemini API 金鑰。此金鑰僅會保存在您當前的瀏覽器記憶體中，離開網頁後將自動清除。設定後將優先使用您的金鑰。'}
              </p>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (tempApiKey.trim()) {
                  setCustomApiKey(tempApiKey.trim());
                  setShowApiKeyInput(false);
                  setTimeout(() => handleRefreshAll(tempApiKey.trim()), 100);
                } else if (apiKeyModalReason === 'MANUAL' && tempApiKey.trim() === '') {
                  setCustomApiKey('');
                  setShowApiKeyInput(false);
                  setTimeout(() => handleRefreshAll(''), 100);
                }
              }}>
                <div className="flex items-center gap-2 mb-4">
                  <input 
                    type="password" 
                    value={tempApiKey}
                    onChange={(e) => { setTempApiKey(e.target.value); setTempKeyStatus(null); }}
                    placeholder="AIzaSy..."
                    className={`flex-1 w-full bg-black border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:ring-1 font-mono text-sm ${apiKeyModalReason === 'RATE_LIMIT' ? 'focus:border-red-500 focus:ring-red-500' : 'focus:border-blue-500 focus:ring-blue-500'}`}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleTestTempKey}
                    disabled={!tempApiKey.trim() || testingTempKey}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {testingTempKey ? '測試中...' : '測試金鑰'}
                  </button>
                </div>
                {tempKeyStatus && (
                  <div className={`text-sm mb-4 flex flex-col gap-1 ${tempKeyStatus === 'VALID' ? 'text-green-500' : tempKeyStatus === 'RATE_LIMITED' ? 'text-yellow-500' : 'text-red-500'}`}>
                    <div>狀態: {tempKeyStatus === 'VALID' ? '🟢 正常可用' : tempKeyStatus === 'RATE_LIMITED' ? '🟡 頻率受限 (Rate Limited)' : '🔴 無效金鑰'}</div>
                    {(tempKeyStatus === 'VALID' || tempKeyStatus === 'RATE_LIMITED') && keyUsageStats[tempApiKey.trim()] && (
                      <div className="text-xs text-blue-400/80 flex items-center gap-2 mt-1">
                        <span>剩餘額度: ~{Math.max(0, 1500 - (keyUsageStats[tempApiKey.trim()]?.requestsToday || 0))} 次</span>
                        <span className="opacity-70">• 重置: {getNextQuotaResetTime().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowApiKeyInput(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    disabled={apiKeyModalReason === 'RATE_LIMIT' && !tempApiKey.trim()}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      apiKeyModalReason === 'RATE_LIMIT' 
                        ? 'bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500/30' 
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30'
                    }`}
                  >
                    {apiKeyModalReason === 'MANUAL' && !tempApiKey.trim() ? '清除金鑰並繼續' : '確認並繼續'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Key Status Modal */}
      <AnimatePresence>
        {showKeyStatusModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0a0a0a] tech-border p-6 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3 text-zinc-100">
                  <Activity className="w-6 h-6" />
                  <h2 className="text-lg font-bold">內建 API 金鑰狀態</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      if (isAdminMode) {
                        setIsAdminMode(false);
                      } else {
                        setShowAdminLogin(!showAdminLogin);
                      }
                    }}
                    className={`p-2 rounded-full transition-colors ${isAdminMode ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-zinc-800 text-zinc-400'}`}
                    title="管理員模式"
                  >
                    {isAdminMode ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={handleCheckAllKeys}
                    disabled={checkingKeys}
                    className="p-2 hover:bg-zinc-800 rounded-full transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 text-zinc-400 ${checkingKeys ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {showAdminLogin && !isAdminMode && (
                <div className="mb-4 flex gap-2">
                  <input 
                    type="password" 
                    placeholder="輸入管理員密碼" 
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    className="flex-1 bg-black border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                  />
                  <button 
                    onClick={() => {
                      if (adminPassword === 'hero3102') {
                        setIsAdminMode(true);
                        setShowAdminLogin(false);
                        setAdminPassword('');
                      } else {
                        alert('密碼錯誤');
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded text-sm hover:bg-blue-500/30 transition-colors"
                  >
                    解鎖
                  </button>
                </div>
              )}

              <div className="mb-4 text-xs text-zinc-400 font-mono bg-black/30 p-3 rounded border border-zinc-800 flex flex-col gap-2">
                {autoRefresh && lastUpdated && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    下次自動更新時間: <span className="text-zinc-300">{new Date(lastUpdated.getTime() + 6 * 60 * 60 * 1000).toLocaleTimeString()}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 text-zinc-500" />
                  API 配額重置時間: <span className="text-zinc-300">{getNextQuotaResetTime().toLocaleString()} (當地時間)</span>
                </div>
              </div>
              
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {checkingKeys && keyStatuses.length === 0 ? (
                  <div className="text-center text-zinc-500 py-4 text-sm">檢查中...</div>
                ) : (
                  keyStatuses.map((ks, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded bg-black/50 border border-zinc-800">
                      <div className="font-mono text-xs text-zinc-400">
                        {ks.key.substring(0, 10)}...{ks.key.substring(ks.key.length - 4)}
                        {ks.usage && (
                          <div className="mt-1.5 text-[10px] text-zinc-500 font-sans flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-green-500/70">✓ {ks.usage.success}</span>
                              <span className="text-red-500/70">✗ {ks.usage.errors}</span>
                              {ks.usage.lastUsed && (
                                <span className="opacity-70">
                                  • {ks.usage.lastUsed.toLocaleTimeString()}
                                </span>
                              )}
                            </div>
                            {(ks.status === 'VALID' || ks.status === 'RATE_LIMITED') && (
                              <div className="flex items-center gap-2 text-blue-400/80">
                                <span>剩餘額度: ~{Math.max(0, 1500 - (ks.usage.requestsToday || 0))} 次</span>
                                <span className="opacity-70">• 重置: {getNextQuotaResetTime().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                              </div>
                            )}
                            {ks.status === 'RATE_LIMITED' && (
                              <div className="text-[10px] text-yellow-500/80 mt-0.5">
                                * 可能觸發每分鐘 15 次限制，請稍後再試
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`text-xs font-bold px-2 py-1 rounded ${
                          ks.status === 'VALID' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 
                          ks.status === 'RATE_LIMITED' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' : 
                          'bg-red-500/10 text-red-500 border border-red-500/20'
                        }`}>
                          {ks.status === 'VALID' ? '🟢 正常' : ks.status === 'RATE_LIMITED' ? '🟡 受限' : '🔴 無效'}
                        </div>
                        {isAdminMode && (
                          <button 
                            onClick={() => {
                              if (confirm('確定要刪除此金鑰嗎？')) {
                                const currentKeys = getFallbackKeys();
                                const newKeys = currentKeys.filter(k => k !== ks.key);
                                saveFallbackKeys(newKeys);
                                handleCheckAllKeys();
                              }
                            }}
                            className="p-1.5 text-red-500 hover:bg-red-500/20 rounded transition-colors"
                            title="刪除金鑰"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {isAdminMode && (
                <div className="mt-4 pt-4 border-t border-zinc-800 flex gap-2">
                  <input 
                    type="text" 
                    placeholder="新增 API 金鑰 (AIzaSy...)" 
                    value={newFallbackKey}
                    onChange={e => setNewFallbackKey(e.target.value)}
                    className="flex-1 bg-black border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button 
                    onClick={() => {
                      if (newFallbackKey.trim()) {
                        const currentKeys = getFallbackKeys();
                        if (!currentKeys.includes(newFallbackKey.trim())) {
                          saveFallbackKeys([...currentKeys, newFallbackKey.trim()]);
                          setNewFallbackKey('');
                          handleCheckAllKeys();
                        } else {
                          alert('此金鑰已存在');
                        }
                      }
                    }}
                    disabled={!newFallbackKey.trim()}
                    className="px-3 py-1.5 bg-green-500/20 text-green-500 rounded text-sm hover:bg-green-500/30 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" /> 新增
                  </button>
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setShowKeyStatusModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  關閉
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Threat Details Modal */}
      <AnimatePresence>
        {showThreatDetails && threatLevel && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0a0a0a] tech-border p-6 max-w-2xl w-full shadow-2xl max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6 border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-3 text-zinc-100">
                  <Radar className="w-6 h-6 text-red-500" />
                  <h2 className="text-xl font-bold">威脅等級評估報告 (Threat Assessment)</h2>
                </div>
                <button 
                  onClick={() => setShowThreatDetails(false)}
                  className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between bg-[#0a0a0a] p-4 tech-border">
                  <div>
                    <div className="text-sm text-zinc-500 font-mono mb-1">TOTAL SCORE</div>
                    <div className="text-4xl font-bold text-zinc-100">
                      <span className={getScoreStyle(threatLevel.totalScore)}>{threatLevel.totalScore}</span> <span className="text-lg text-zinc-500 font-normal">/ 100</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-zinc-500 font-mono mb-1">THREAT LEVEL</div>
                    <div className={`text-2xl font-bold ${THREAT_COLORS[threatLevel.level] || 'text-zinc-100'}`}>
                      {threatLevel.level}
                    </div>
                  </div>
                </div>

                {threatLevel.scores && (
                  <div>
                    <h3 className="text-sm font-mono text-zinc-500 uppercase tracking-wider mb-3">Dimension Scores (權重評分)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                      <div className="bg-[#111] p-3 tech-border text-center">
                        <div className="text-xs text-zinc-400 mb-1">軍事 (40%)</div>
                        <div className="text-3xl font-bold font-mono text-red-400">{threatLevel.scores.military}</div>
                      </div>
                      <div className="bg-[#111] p-3 tech-border text-center">
                        <div className="text-xs text-zinc-400 mb-1">經濟 (25%)</div>
                        <div className="text-3xl font-bold font-mono text-orange-400">{threatLevel.scores.economic}</div>
                      </div>
                      <div className="bg-[#111] p-3 tech-border text-center">
                        <div className="text-xs text-zinc-400 mb-1">外交 (20%)</div>
                        <div className="text-3xl font-bold font-mono text-blue-400">{threatLevel.scores.diplomatic}</div>
                      </div>
                      <div className="bg-[#111] p-3 tech-border text-center">
                        <div className="text-xs text-zinc-400 mb-1">認知 (15%)</div>
                        <div className="text-3xl font-bold font-mono text-purple-400">{threatLevel.scores.cognitive}</div>
                      </div>
                    </div>
                    
                    <div className="h-64 w-full bg-[#0a0a0a] tech-border p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: '軍事 (Military)', value: threatLevel.scores.military * 0.4, color: '#ef4444' },
                              { name: '經濟 (Economic)', value: threatLevel.scores.economic * 0.25, color: '#f97316' },
                              { name: '外交 (Diplomatic)', value: threatLevel.scores.diplomatic * 0.2, color: '#3b82f6' },
                              { name: '認知 (Cognitive)', value: threatLevel.scores.cognitive * 0.15, color: '#a855f7' },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {
                              [
                                { name: '軍事 (Military)', value: threatLevel.scores.military * 0.4, color: '#ef4444' },
                                { name: '經濟 (Economic)', value: threatLevel.scores.economic * 0.25, color: '#f97316' },
                                { name: '外交 (Diplomatic)', value: threatLevel.scores.diplomatic * 0.2, color: '#3b82f6' },
                                { name: '認知 (Cognitive)', value: threatLevel.scores.cognitive * 0.15, color: '#a855f7' },
                              ].map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))
                            }
                          </Pie>
                          <Tooltip 
                            formatter={(value: number) => value.toFixed(1)}
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', color: '#e4e4e7', borderRadius: '0.5rem' }}
                            itemStyle={{ color: '#e4e4e7' }}
                          />
                          <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {threatLevel.explanation && (
                  <div>
                    <h3 className="text-sm font-mono text-zinc-500 uppercase tracking-wider mb-3">Assessment Explanation (評估說明)</h3>
                    <div className="bg-[#0a0a0a] p-4 tech-border text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                      {threatLevel.explanation}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
