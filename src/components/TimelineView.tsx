import React, { useEffect, useState } from 'react';
import { Chrono } from 'react-chrono';
import { fetchTimelineEvents, TimelineEvent } from '../services/intelligenceService';
import { Activity, AlertTriangle, Crosshair, Globe, TrendingDown } from 'lucide-react';

interface TimelineViewProps {
  apiKey?: string;
  isPaidApiKey?: boolean;
}

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

  const items = events.map(event => ({
    title: event.date,
    cardTitle: event.title,
    cardDetailedText: event.description,
  }));

  return (
    <div className="bg-[#0a0a0a] tech-border p-6 mt-6">
      <h3 className="text-xl font-mono font-bold text-zinc-100 mb-6 border-b border-zinc-800 pb-2 flex items-center gap-2">
        <Activity className="w-5 h-5 text-red-500" />
        TIMELINE // 過去一週重大事件
      </h3>
      <div className="w-full" style={{ height: '500px' }}>
        <Chrono
          items={items}
          mode="VERTICAL_ALTERNATING"
          theme={{
            primary: '#ef4444',
            secondary: '#18181b',
            cardBgColor: '#18181b',
            cardForeColor: '#f4f4f5',
            titleColor: '#ef4444',
            titleColorActive: '#ef4444',
          }}
          fontSizes={{
            cardSubtitle: '0.85rem',
            cardText: '0.8rem',
            cardTitle: '1rem',
            title: '1rem',
          }}
          classNames={{
            card: 'tech-border',
            cardTitle: 'font-mono font-bold text-red-500',
            cardText: 'text-zinc-400 mt-2',
            title: 'font-mono text-red-500',
          }}
          hideControls
          useReadMore={false}
        />
      </div>
    </div>
  );
}
