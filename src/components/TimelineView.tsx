import React, { useEffect, useState } from 'react';
import { fetchTimelineEvents, TimelineEvent } from '../services/intelligenceService';
import { Activity, AlertTriangle, Crosshair, Globe, TrendingDown } from 'lucide-react';

interface TimelineViewProps {
  apiKey?: string;
  isPaidApiKey?: boolean;
  refreshTrigger?: number;
}

const getCategoryStyles = (category: string) => {
  switch (category) {
    case 'military': 
      return { border: 'border-red-500', text: 'text-red-500', triangle: 'border-t-red-500' };
    case 'economic': 
      return { border: 'border-orange-500', text: 'text-orange-500', triangle: 'border-t-orange-500' };
    case 'diplomatic': 
      return { border: 'border-blue-500', text: 'text-blue-500', triangle: 'border-t-blue-500' };
    case 'cognitive': 
      return { border: 'border-purple-500', text: 'text-purple-500', triangle: 'border-t-purple-500' };
    default: 
      return { border: 'border-green-500', text: 'text-green-500', triangle: 'border-t-green-500' };
  }
};

const getCategoryIcon = (category: string, className: string) => {
  switch (category) {
    case 'military': return <Crosshair className={className} />;
    case 'economic': return <TrendingDown className={className} />;
    case 'diplomatic': return <Globe className={className} />;
    case 'cognitive': return <AlertTriangle className={className} />;
    default: return <Activity className={className} />;
  }
};

export function TimelineView({ apiKey, isPaidApiKey, refreshTrigger = 0 }: TimelineViewProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEvents() {
      if (!apiKey) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await fetchTimelineEvents(apiKey, refreshTrigger > 0, isPaidApiKey);
        setEvents(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, [apiKey, isPaidApiKey, refreshTrigger]);

  if (loading) {
    return (
      <div className="bg-[#0a0a0a] tech-border p-6 mt-6 flex flex-col items-center justify-center min-h-[300px]">
        <Activity className="w-8 h-8 text-red-500 animate-pulse mb-4" />
        <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest">載入過去一週重大事件...</p>
      </div>
    );
  }

  if (!apiKey) {
    return null;
  }

  if (!events || !Array.isArray(events) || events.length === 0) {
    return (
      <div className="bg-[#0a0a0a] tech-border p-6 mt-6 flex flex-col items-center justify-center min-h-[300px]">
        <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest">過去一週無重大事件或無法取得資料</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0a0a] tech-border p-6 mt-6 overflow-hidden">
      <h3 className="text-xl font-mono font-bold text-zinc-100 mb-12 border-b border-zinc-800 pb-2 flex items-center gap-2">
        <Activity className="w-5 h-5 text-red-500" />
        TIMELINE // 過去一週重大事件
      </h3>
      
      <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
        <div className="relative flex flex-row items-start justify-between min-w-max gap-4 px-4">
          {/* Horizontal Line */}
          <div className="absolute top-8 left-0 w-full h-[2px] bg-zinc-800 z-0" />
          
          {events.map((event, index) => {
            const styles = getCategoryStyles(event.category);
            return (
              <div key={index} className="relative flex flex-col items-center w-36 z-10">
                {/* Node Container */}
                <div className="relative w-16 h-16 flex flex-col items-center bg-[#0a0a0a] rounded-full">
                  {/* Top half colored ring */}
                  <div className={`absolute top-0 left-0 w-full h-8 border-t-[4px] border-l-[4px] border-r-[4px] ${styles.border} rounded-t-full bg-[#0a0a0a]`} />
                  
                  {/* Inner circle */}
                  <div className="absolute top-[4px] w-14 h-14 rounded-full bg-[#18181b] border border-zinc-800 flex items-center justify-center shadow-xl z-10">
                    {getCategoryIcon(event.category, `w-6 h-6 ${styles.text}`)}
                  </div>
                  
                  {/* Bottom Triangle */}
                  <div className={`absolute top-[60px] w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent ${styles.triangle} z-0`} />
                </div>

                {/* Content */}
                <div className="mt-8 text-center flex flex-col items-center w-full">
                  <h4 className={`text-sm font-mono font-bold ${styles.text} mb-2`}>{event.date}</h4>
                  <h5 className="text-xs font-bold text-zinc-100 line-clamp-3 mb-3 min-h-[48px]" title={event.title}>
                    {event.url ? (
                      <a href={event.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 hover:underline transition-colors">
                        {event.title}
                      </a>
                    ) : (
                      event.title
                    )}
                  </h5>
                  
                  {/* KPI Indicator */}
                  {event.impactLevel && (
                    <div className="flex flex-col items-center w-full px-2" title={`影響力等級: ${event.impactLevel}/10`}>
                      <div className="flex items-center gap-1 mb-1">
                        <Activity className={`w-3 h-3 ${event.impactLevel >= 8 ? 'text-red-500' : event.impactLevel >= 5 ? 'text-orange-500' : 'text-blue-500'}`} />
                        <span className="text-[10px] font-mono text-zinc-500">IMPACT</span>
                      </div>
                      <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden flex">
                        <div 
                          className={`h-full ${event.impactLevel >= 8 ? 'bg-red-500' : event.impactLevel >= 5 ? 'bg-orange-500' : 'bg-blue-500'}`} 
                          style={{ width: `${(event.impactLevel / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
