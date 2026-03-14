import React, { useEffect, useState } from 'react';
import { fetchTimelineEvents, TimelineEvent } from '../services/intelligenceService';
import { Activity, AlertTriangle, Crosshair, Globe, TrendingDown } from 'lucide-react';

interface TimelineViewProps {
  apiKey?: string;
  isPaidApiKey?: boolean;
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

export function TimelineView({ apiKey, isPaidApiKey }: TimelineViewProps) {
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
        const data = await fetchTimelineEvents(apiKey, false, isPaidApiKey);
        setEvents(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadEvents();
  }, [apiKey, isPaidApiKey]);

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

  if (events.length === 0) {
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
      
      <div className="w-full overflow-x-auto pb-8 custom-scrollbar">
        <div className="relative flex flex-row items-start justify-between min-w-max gap-8 px-8">
          {/* Horizontal Line */}
          <div className="absolute top-12 left-0 w-full h-[2px] bg-zinc-800 z-0" />
          
          {events.map((event, index) => {
            const styles = getCategoryStyles(event.category);
            return (
              <div key={index} className="relative flex flex-col items-center w-64 z-10">
                {/* Node Container */}
                <div className="relative w-24 h-24 flex flex-col items-center bg-[#0a0a0a] rounded-full">
                  {/* Top half colored ring */}
                  <div className={`absolute top-0 left-0 w-full h-12 border-t-[6px] border-l-[6px] border-r-[6px] ${styles.border} rounded-t-full bg-[#0a0a0a]`} />
                  
                  {/* Inner circle */}
                  <div className="absolute top-[8px] w-20 h-20 rounded-full bg-[#18181b] border border-zinc-800 flex items-center justify-center shadow-xl z-10">
                    {getCategoryIcon(event.category, `w-8 h-8 ${styles.text}`)}
                  </div>
                  
                  {/* Bottom Triangle */}
                  <div className={`absolute top-[88px] w-0 h-0 border-l-[10px] border-r-[10px] border-t-[12px] border-l-transparent border-r-transparent ${styles.triangle} z-0`} />
                </div>

                {/* Content */}
                <div className="mt-8 text-center flex flex-col items-center">
                  <h4 className={`text-lg font-mono font-bold ${styles.text} mb-1`}>{event.date}</h4>
                  <h5 className="text-sm font-bold text-zinc-100 mb-2 line-clamp-2 h-10 flex items-center">{event.title}</h5>
                  <p className="text-xs text-zinc-400 line-clamp-4 text-left w-full">{event.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
