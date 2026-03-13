import React, { useState, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RefreshCw, Map as MapIcon, Crosshair, AlertTriangle } from 'lucide-react';
import { fetchMapData, MapData } from '../services/intelligenceService';

// Approximate 2022 PLA exercise zones around Taiwan
const EXERCISE_ZONES: [number, number][][] = [
  [[25.25, 120.23], [25.25, 120.85], [24.83, 120.85], [24.83, 120.23]], // NW
  [[25.95, 121.26], [25.95, 121.83], [25.38, 121.83], [25.38, 121.26]], // N
  [[25.56, 122.18], [25.56, 122.83], [24.93, 122.83], [24.93, 122.18]], // NE
  [[22.71, 122.83], [22.71, 123.41], [22.08, 123.41], [22.08, 122.83]], // E
  [[21.23, 121.55], [21.23, 120.95], [20.88, 120.95], [20.88, 121.55]], // S
  [[22.88, 119.41], [22.88, 120.08], [22.43, 120.08], [22.43, 119.41]], // SW
];

// Simulated initial targets
const INITIAL_TARGETS = [
  { id: 1, lat: 24.5, lng: 119.5, type: 'ship', heading: 45 },
  { id: 2, lat: 26.1, lng: 122.5, type: 'aircraft', heading: 180 },
  { id: 3, lat: 21.5, lng: 121.0, type: 'ship', heading: 270 },
  { id: 4, lat: 23.0, lng: 119.0, type: 'aircraft', heading: 90 },
  { id: 5, lat: 25.0, lng: 120.0, type: 'fishing', heading: 135 },
  { id: 6, lat: 22.5, lng: 120.5, type: 'fishing', heading: 315 },
  { id: 7, lat: 24.0, lng: 119.8, type: 'fishing', heading: 60 },
];

const createTargetIcon = (type: string, heading: number) => {
  let svgPath = '';
  let color = '';
  
  if (type === 'aircraft') {
    svgPath = '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L3 8l6 5-3 3-3.2-.8c-.4-.1-.8.2-1 .6L4 17l4 1 1 4 .2-.2c.4-.2.7-.6.6-1l-.8-3.2 3-3 5 6 1.2-.7c.4-.2.7-.6.6-1.1z"/>';
    color = '#ef4444'; // Red for military aircraft
  } else if (type === 'ship') {
    svgPath = '<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 3.25-2 6-2s3.5 2 6 2c1.3 0 1.9-.5 2.5-1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/>';
    color = '#f59e0b'; // Amber for military ships
  } else {
    // fishing
    svgPath = '<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>';
    color = '#10b981'; // Green for civilian/fishing
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
  
  return L.divIcon({
    html: `<div style="transform: rotate(${heading}deg); color: ${color}; filter: drop-shadow(0 0 4px ${color}); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: rgba(0,0,0,0.7); border-radius: 50%; border: 1px solid ${color};">${svg}</div>`,
    className: 'custom-target-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

export const SatelliteMaps: React.FC<{ apiKey?: string }> = ({ apiKey }) => {
  const [lastUpdated1, setLastUpdated1] = useState<Date>(new Date());
  const [lastUpdated2, setLastUpdated2] = useState<Date>(new Date());
  const [isRefreshing1, setIsRefreshing1] = useState(false);
  const [isRefreshing2, setIsRefreshing2] = useState(false);
  
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [targets, setTargets] = useState(INITIAL_TARGETS);
  const [exerciseZones, setExerciseZones] = useState<MapData['exerciseZones']>([]);

  const loadData = useCallback(async (force = false) => {
    if (!apiKey) return;
    setIsRefreshing1(true);
    setIsRefreshing2(true);
    try {
      const data = await fetchMapData(apiKey, force);
      if (data) {
        setMapData(data);
        if (data.surveillance?.targets?.length > 0) {
          setTargets(data.surveillance.targets);
        }
        if (data.exerciseZones) {
          setExerciseZones(data.exerciseZones);
        }
        const now = new Date();
        setLastUpdated1(now);
        setLastUpdated2(now);
      }
    } finally {
      setIsRefreshing1(false);
      setIsRefreshing2(false);
    }
  }, [apiKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh1 = useCallback(() => {
    loadData(true);
  }, [loadData]);

  const handleRefresh2 = useCallback(() => {
    loadData(true);
  }, [loadData]);

  // Fallback to initial zones if none fetched
  const displayZones = exerciseZones.length > 0 ? exerciseZones : [{ name: '常態演訓區', time: '持續', type: '海空巡邏', coordinates: EXERCISE_ZONES[0] }];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6 mb-6">
      {/* Map 1: Exercise Zones */}
      <div className="bg-[#0a0a0a] tech-border flex flex-col overflow-hidden">
        <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-red-500" />
            <span className="font-mono text-[11px] md:text-xs text-zinc-300 font-bold truncate">中方劃設的演訓及禁航區範圍衛星圖</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[9px] md:text-[10px] text-zinc-500 hidden sm:inline-block">
              UPDATED: {lastUpdated1.toLocaleTimeString()}
            </span>
            <button 
              onClick={handleRefresh1}
              disabled={isRefreshing1}
              className="text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50 p-1"
              title="即時更新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing1 ? 'animate-spin text-red-500' : ''}`} />
            </button>
          </div>
        </div>
        {/* Reduced height from 300px to 160px for responsive half-size */}
        <div className="h-[160px] md:h-[180px] w-full relative bg-zinc-950 z-0">
          <MapContainer 
            center={[23.6978, 120.9605]} 
            zoom={5} 
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%', background: '#050505' }}
            attributionControl={false}
          >
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={18}
            />
            {exerciseZones.length > 0 ? exerciseZones.map((zone, idx) => (
              <Polygon 
                key={idx} 
                positions={zone.coordinates} 
                pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.3, weight: 2, dashArray: '5, 5' }} 
              />
            )) : EXERCISE_ZONES.map((positions, idx) => (
              <Polygon 
                key={idx} 
                positions={positions} 
                pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.3, weight: 2, dashArray: '5, 5' }} 
              />
            ))}
          </MapContainer>
          
          {/* Announcement Overlay */}
          {exerciseZones.length > 0 && (
            <div className="absolute bottom-2 left-2 z-[500] bg-black/80 border border-red-500/50 p-2 rounded text-[9px] md:text-[10px] font-mono backdrop-blur-sm pointer-events-none shadow-[0_0_10px_rgba(239,68,68,0.2)]">
              <div className="text-red-500 font-bold mb-0.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                [NAVWARN] 禁航/禁飛區公告
              </div>
              <div className="text-zinc-300">主題: {exerciseZones[0].name}</div>
              <div className="text-zinc-300">時間: {exerciseZones[0].time}</div>
              <div className="text-zinc-300">性質: {exerciseZones[0].type}</div>
            </div>
          )}

          {/* Overlay scanning effect */}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-[400] opacity-30"></div>
        </div>
      </div>

      {/* Map 2: Surveillance */}
      <div className="bg-[#0a0a0a] tech-border flex flex-col overflow-hidden">
        <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-emerald-500" />
            <span className="font-mono text-[11px] md:text-xs text-zinc-300 font-bold truncate">台灣海空監控衛星圖</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[9px] md:text-[10px] text-zinc-500 hidden sm:inline-block">
              UPDATED: {lastUpdated2.toLocaleTimeString()}
            </span>
            <button 
              onClick={handleRefresh2}
              disabled={isRefreshing2}
              className="text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50 p-1"
              title="即時更新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing2 ? 'animate-spin text-emerald-500' : ''}`} />
            </button>
          </div>
        </div>
        {/* Reduced height from 300px to 160px for responsive half-size */}
        <div className="h-[160px] md:h-[180px] w-full relative bg-zinc-950 z-0">
          <MapContainer 
            center={[23.6978, 120.9605]} 
            zoom={5} 
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%', background: '#050505' }}
            attributionControl={false}
          >
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              maxZoom={16}
            />
            {targets.map(target => (
              <Marker 
                key={target.id}
                position={[target.lat, target.lng]}
                icon={createTargetIcon(target.type, target.heading)}
              >
                <Popup className="font-mono text-xs">
                  <div className="text-zinc-800">
                    <strong>{target.type.toUpperCase()}</strong><br/>
                    LAT: {target.lat.toFixed(4)}<br/>
                    LNG: {target.lng.toFixed(4)}<br/>
                    HDG: {Math.round(target.heading)}°
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          
          {/* Surveillance Stats Overlay */}
          {mapData?.surveillance && (
            <div className="absolute bottom-2 left-2 z-[500] bg-black/80 border border-emerald-500/50 p-2 rounded text-[9px] md:text-[10px] font-mono backdrop-blur-sm pointer-events-none shadow-[0_0_10px_rgba(16,185,129,0.2)]">
              <div className="text-emerald-500 font-bold mb-0.5">
                [STATS] 國防部即時動態
              </div>
              <div className="text-zinc-300">更新時間: {mapData.surveillance.updateTime}</div>
              <div className="text-zinc-300">偵獲共機: <span className="text-red-400">{mapData.surveillance.aircraftTotal}</span> 架次 (逾越中線: {mapData.surveillance.aircraftCrossed})</div>
              <div className="text-zinc-300">偵獲共艦: <span className="text-amber-400">{mapData.surveillance.shipsTotal}</span> 艘次</div>
              <div className="text-zinc-300">公務船隻: <span className="text-emerald-400">{mapData.surveillance.officialShips}</span> 艘次</div>
            </div>
          )}

          {/* Radar sweep effect */}
          <div className="absolute inset-0 pointer-events-none z-[400] overflow-hidden">
            <div className="absolute top-1/2 left-1/2 w-[200%] h-[200%] -translate-x-1/2 -translate-y-1/2 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(16,185,129,0.1)_90deg,transparent_90deg)] animate-[spin_4s_linear_infinite] rounded-full"></div>
            <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] opacity-30"></div>
          </div>
        </div>
      </div>
    </div>
  );
};
