import { GoogleGenAI } from '@google/genai';

class ApiRateManager {
  private queue: (() => Promise<void>)[] = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private readonly minDelayMs = 2000; // 2 seconds delay
  private callCount = 0;
  private lastResetTime = Date.now();
  private subscribers: ((count: number) => void)[] = [];
  private readonly STORAGE_KEY = 'api_rate_manager_state';

  constructor() {
    this.loadState();
    // Cleanup interval every minute
    setInterval(() => this.cleanup(), 60000);
  }

  private loadState() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        const now = Date.now();
        // Reset if more than 1 minute has passed
        if (now - state.lastResetTime > 60000) {
          this.callCount = 0;
          this.lastResetTime = now;
        } else {
          this.callCount = state.callCount;
          this.lastResetTime = state.lastResetTime;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  private saveState() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        callCount: this.callCount,
        lastResetTime: this.lastResetTime
      }));
    } catch (e) {
      // ignore
    }
  }

  private cleanup() {
    const now = Date.now();
    if (now - this.lastResetTime > 60000) {
      this.callCount = 0;
      this.lastResetTime = now;
      this.saveState();
      this.notifySubscribers();
    }
  }

  subscribe(callback: (count: number) => void): () => void {
    this.subscribers.push(callback);
    callback(this.callCount);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  private notifySubscribers() {
    this.subscribers.forEach(cb => cb(this.callCount));
  }

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          this.cleanup();
          this.callCount++;
          this.saveState();
          this.notifySubscribers();
          
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      
      if (timeSinceLastRequest < this.minDelayMs) {
        await new Promise(resolve => setTimeout(resolve, this.minDelayMs - timeSinceLastRequest));
      }

      const task = this.queue.shift();
      if (task) {
        this.lastRequestTime = Date.now();
        await task();
      }
    }

    this.isProcessing = false;
  }
}

export const apiRateManager = new ApiRateManager();

export async function executeWithLock<T>(task: () => Promise<T>, bypassQueue = false): Promise<T> {
  if (bypassQueue) {
    return task();
  }
  return apiRateManager.enqueue(task);
}

export interface IntelligenceData {
  text: string;
  sources: { title: string; uri: string }[];
  timestamp?: number;
  isMissingKey?: boolean;
  isRateLimited?: boolean;
  isDailyLimit?: boolean;
  isInvalidKey?: boolean;
}

export interface ThreatLevelData {
  level: 'LOW' | 'GUARDED' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  totalScore: number;
  summary: string;
  sources: { title: string; uri: string }[];
  timestamp?: number;
  scores: {
    military: number;
    economic: number;
    diplomatic: number;
    cognitive: number;
  };
  isMissingKey?: boolean;
  isRateLimited?: boolean;
  isDailyLimit?: boolean;
  isInvalidKey?: boolean;
  explanation?: string;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getTaipeiDateString(offsetDays = 0) {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const taipeiDate = new Date(utc + (3600000 * 8));
  taipeiDate.setDate(taipeiDate.getDate() + offsetDays);
  const year = taipeiDate.getFullYear();
  const month = String(taipeiDate.getMonth() + 1).padStart(2, '0');
  const day = String(taipeiDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalCache(key: string) {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL) {
        return { ...parsed.data, timestamp: parsed.timestamp };
      }
      localStorage.removeItem(key);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function setLocalCache(key: string, data: any) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    // ignore
  }
}

export async function fetchIntelligence(categoryId: string, categoryQuery: string, customApiKey?: string, forceRefresh = false, isPaidKey = false): Promise<IntelligenceData> {
  const cleanApiKey = customApiKey?.trim().replace(/[\s\uFEFF\xA0]/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanApiKey) {
    return {
      text: `⚠️ **需要 API 金鑰**\n\n請在設定中輸入您的 Google Gemini API 金鑰以取得即時戰情。`,
      sources: [],
      isMissingKey: true
    };
  }

  const cacheKey = `intel_${categoryId}_${cleanApiKey || 'default'}`;
  
  if (!forceRefresh) {
    const cachedData = getLocalCache(cacheKey);
    if (cachedData) {
      return cachedData as IntelligenceData;
    }
  }

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const todayStr = getTaipeiDateString(0);
  const yesterdayStr = getTaipeiDateString(-1);
  const tomorrowStr = getTaipeiDateString(1);
  
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const taipeiDate = new Date(utc + (3600000 * 8));
  const currentYear = taipeiDate.getFullYear();
  const currentMonth = taipeiDate.getMonth() + 1;

  let prompt = '';
  if (categoryId === 'new_threat') {
    prompt = `現在精確時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是彙整「當日（台灣時間 ${todayStr} 00:00 至 23:59）」關於中國對台灣的最新動態與新聞。
【注意】：已取消「過去24小時」的定義，請嚴格只抓取「當日」的資料。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月" 以及日期 "${todayStr}"，並強制加上 "after:${yesterdayStr} before:${tomorrowStr}" 參數，以確保搜尋引擎只回傳當日的結果。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${todayStr} 當日）的來源需「嚴格全部捨棄」，絕對不可寫入報告，也不可作為 Verified Sources。
3. 寧缺勿濫：如果搜尋後發現「沒有」當日的最新重大消息，請直接回答「當日無重大事件」，絕對不允許拿舊新聞來湊數。
4. 連結正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果，不要自己發明或猜測網址。

請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：請分析並列出當日與台海相關的重大「軍事」、「經濟」、「外交」或「認知作戰」的事件。
   - 格式：請具體寫出時間點與消息來源，並「強制標示該新聞的發布日期與時間」（例如：根據 CNN 於 YYYY-MM-DD HH:MM 的報導）。
   - 警告：「絕對不要」在內文中產生任何 Markdown 網址連結（例如 [CNN 報導](https://...)），因為系統會自動在底部附上真實的來源連結。
2. **威脅評估**：分析這些行動對台灣的整體影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  } else {
    prompt = `現在精確時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是彙整「當日（台灣時間 ${todayStr} 00:00 至 23:59）」關於中國對台灣的「${categoryQuery}」最新動態與新聞。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月" 以及日期 "${todayStr}"，並強制加上 "after:${yesterdayStr} before:${tomorrowStr}" 參數，確保只獲取當日的資料。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${todayStr} 當日）的來源需「嚴格全部捨棄」，絕對不可寫入報告，也不可作為 Verified Sources。
3. 寧缺勿濫：如果搜尋後發現「沒有」當日的最新重大消息，請直接回答「當日無重大事件」，絕對不允許拿舊新聞來湊數。
4. 連結正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果，不要自己發明或猜測網址。

請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：列出具體事件。
   - 格式：請具體寫出時間點與消息來源，並「強制標示該新聞的發布日期與時間」（例如：根據 CNN 於 YYYY-MM-DD HH:MM 的報導）。
   - 警告：「絕對不要」在內文中產生任何 Markdown 網址連結（例如 [CNN 報導](https://...)），因為系統會自動在底部附上真實的來源連結。
2. **威脅評估**：分析這些行動對台灣的影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  }

  let lastError: any = null;

  const ai = new GoogleGenAI({ apiKey: cleanApiKey });
  try {
    const response = await executeWithLock(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      },
    }), isPaidKey);

    const text = response.text || '';
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];
    const groundingSupports = groundingMetadata?.groundingSupports || [];

    const usedChunkIndices = new Set<number>();
    if (groundingSupports.length > 0) {
      groundingSupports.forEach((support: any) => {
        if (support.groundingChunkIndices) {
          support.groundingChunkIndices.forEach((index: number) => usedChunkIndices.add(index));
        }
      });
    }

    const sources = groundingChunks
      .filter((_: any, index: number) => usedChunkIndices.has(index))
      .map((chunk: any) => {
        return {
          title: chunk.web?.title || '未知來源',
          uri: chunk.web?.uri || '',
        };
      })
      .filter((s: any) => s.uri);

    const uniqueSources = Array.from(new Map(sources.map((s: any) => [s.uri, s])).values()) as { title: string; uri: string }[];

    const result = {
      text,
      sources: uniqueSources,
      timestamp: Date.now(),
    };
    setLocalCache(cacheKey, result);
    return result;
  } catch (error: any) {
    lastError = error;

    const isRateLimited = error?.message?.includes('429') || error?.status === 429;
    const isDailyLimit = error?.message?.includes('quota') || error?.message?.includes('Resource has been exhausted');
    const isInvalidKey = error?.message?.includes('API key not valid') || error?.message?.includes('API_KEY_INVALID') || error?.status === 400;
    
    if (!isRateLimited && !isDailyLimit && !isInvalidKey) {
      console.error("Error fetching intelligence:", error);
    }
    
    return {
      text: `⚠️ **無法取得資料**\n\n${isDailyLimit ? '已達每日 API 請求上限，請於太平洋時間午夜後重試。' : isRateLimited ? '已達每分鐘 API 請求上限，請稍後再試。' : isInvalidKey ? 'API 金鑰無效，請檢查您的設定。' : '發生未知錯誤，請稍後再試。'}`,
      sources: [],
      isRateLimited: isRateLimited || isDailyLimit,
      isDailyLimit,
      isInvalidKey
    };
  }
}

export async function fetchOverallThreatLevel(customApiKey?: string, forceRefresh = false, isPaidKey = false): Promise<ThreatLevelData> {
  const cleanApiKey = customApiKey?.trim().replace(/[\s\uFEFF\xA0]/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanApiKey) {
    return {
      level: 'UNKNOWN' as any,
      totalScore: 0,
      summary: '需要 API 金鑰以進行評估',
      sources: [],
      scores: { military: 0, economic: 0, diplomatic: 0, cognitive: 0 }
    };
  }

  const cacheKey = `threat_${cleanApiKey || 'default'}`;
  
  if (!forceRefresh) {
    const cachedData = getLocalCache(cacheKey);
    if (cachedData) {
      return cachedData as ThreatLevelData;
    }
  }

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const todayStr = getTaipeiDateString(0);
  const yesterdayStr = getTaipeiDateString(-1);
  const tomorrowStr = getTaipeiDateString(1);
  
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const taipeiDate = new Date(utc + (3600000 * 8));
  const currentYear = taipeiDate.getFullYear();
  const currentMonth = taipeiDate.getMonth() + 1;

  const prompt = `現在精確時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請嚴格搜尋「當日（台灣時間 ${todayStr} 00:00 至 23:59）」關於台海局勢的新聞（包含國內外媒體及社群網路），評估目前的整體威脅等級。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月" 以及日期 "${todayStr}"，並強制加上 "after:${yesterdayStr} before:${tomorrowStr}" 參數，確保只獲取當日的資料。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${todayStr} 當日）的來源需「嚴格全部捨棄」，絕對不可作為評分依據，也不可作為 Verified Sources。
3. 連結正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果。

請依據以下四個面向給予 0~100 的威脅評分，並套用權重計算總分 (Total Score)：
1. 軍事動態 (Military) - 權重 40%
2. 經濟封鎖 (Economic) - 權重 25%
3. 外交打壓 (Diplomatic) - 權重 20%
4. 認知作戰 (Cognitive) - 權重 15%

總分計算後，請依據以下標準定義威脅等級 (Level)：
- 0~20: LOW (低威脅)
- 21~40: GUARDED (防範)
- 41~60: ELEVATED (升高)
- 61~80: HIGH (高度威脅)
- 81~100: CRITICAL (危急)

請嚴格回傳 JSON 格式，不要包含 Markdown 語法或額外文字。
JSON 格式範例：
{
  "level": "ELEVATED",
  "totalScore": 55,
  "summary": "簡短的整體威脅摘要（繁體中文）...",
  "scores": {
    "military": 60,
    "economic": 40,
    "diplomatic": 50,
    "cognitive": 70
  }
}`;

  let lastError: any = null;

  const ai = new GoogleGenAI({ apiKey: cleanApiKey });
  try {
    const response = await executeWithLock(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }), isPaidKey);

    const text = response.text || '{}';
    let parsedData;
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON response:", text);
      throw new Error("Invalid JSON response from API");
    }

    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];
    const groundingSupports = groundingMetadata?.groundingSupports || [];

    const usedChunkIndices = new Set<number>();
    if (groundingSupports.length > 0) {
      groundingSupports.forEach((support: any) => {
        if (support.groundingChunkIndices) {
          support.groundingChunkIndices.forEach((index: number) => usedChunkIndices.add(index));
        }
      });
    }

    const sources = groundingChunks
      .filter((_: any, index: number) => usedChunkIndices.has(index))
      .map((chunk: any) => {
        return {
          title: chunk.web?.title || '未知來源',
          uri: chunk.web?.uri || '',
        };
      })
      .filter((s: any) => s.uri);

    const uniqueSources = Array.from(new Map(sources.map((s: any) => [s.uri, s])).values()) as { title: string; uri: string }[];

    const result: ThreatLevelData = {
      ...parsedData,
      sources: uniqueSources,
      timestamp: Date.now(),
    };
    
    setLocalCache(cacheKey, result);
    return result;
  } catch (error: any) {
    lastError = error;
    const isRateLimited = error?.message?.includes('429') || error?.status === 429;
    const isDailyLimit = error?.message?.includes('quota') || error?.message?.includes('Resource has been exhausted');
    const isInvalidKey = error?.message?.includes('API key not valid') || error?.message?.includes('API_KEY_INVALID') || error?.status === 400;
    
    if (!isRateLimited && !isDailyLimit && !isInvalidKey) {
      console.error("Error fetching threat level:", error);
    }
    
    return {
      level: 'UNKNOWN' as any,
      totalScore: 0,
      summary: isDailyLimit ? '已達每日 API 請求上限' : isRateLimited ? '已達每分鐘 API 請求上限' : isInvalidKey ? 'API 金鑰無效' : '發生未知錯誤',
      sources: [],
      scores: { military: 0, economic: 0, diplomatic: 0, cognitive: 0 },
      isRateLimited: isRateLimited || isDailyLimit,
      isDailyLimit,
      isInvalidKey
    };
  }
}

export interface MapData {
  surveillance: {
    updateTime: string;
    aircraftTotal: number;
    aircraftCrossed: number;
    shipsTotal: number;
    officialShips: number;
    targets: { id: number; lat: number; lng: number; type: 'aircraft' | 'ship' | 'fishing'; heading: number }[];
  };
  exerciseZones: {
    name: string;
    time: string;
    type: string;
    coordinates: [number, number][];
  }[];
}

export interface TimelineEvent {
  date: string;
  title: string;
  description: string;
  url?: string;
  category: 'military' | 'economic' | 'diplomatic' | 'cognitive' | 'other';
  impactLevel: number; // 1-10
}

export async function fetchTimelineEvents(customApiKey?: string, forceRefresh = false, isPaidKey = false): Promise<TimelineEvent[]> {
  const cleanApiKey = customApiKey?.trim().replace(/[\s\uFEFF\xA0]/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanApiKey) return [];

  const cacheKey = `timeline_${cleanApiKey || 'default'}`;
  
  if (!forceRefresh) {
    const cachedData = getLocalCache(cacheKey);
    if (cachedData && Array.isArray(cachedData)) {
      return cachedData as TimelineEvent[];
    }
  }

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const todayStr = getTaipeiDateString(0);
  const lastWeekStr = getTaipeiDateString(-7);

  const prompt = `現在精確時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是搜尋「過去一週（台灣時間 ${lastWeekStr} 至 ${todayStr}）」關於台海局勢的重大新聞與事件。

【🔴 絕對強制指令 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，必須搜尋過去一週內關於台海軍事、經濟、外交、認知作戰的真實重大事件。
2. 來源網址 (url) 必須是「真實存在」且「直接連到該篇新聞」的絕對網址。**絕對禁止**捏造網址或只提供媒體首頁。你必須從 Google Search 的結果中，精確複製該新聞的真實 URL。如果找不到直接連結，請不要將該事件納入。
3. 請嚴格回傳 JSON 格式，不要包含 Markdown 語法或額外文字。
4. 請確保事件按時間先後順序排列（最舊的在前面，最新的在後面）。
5. 每個事件必須評估其影響力等級 (impactLevel)，範圍為 1 到 10 的整數（10 為最高威脅/影響）。

JSON 格式範例：
[
  {
    "date": "2026-03-08",
    "title": "共機越過海峽中線",
    "description": "國防部偵獲多架次共機越過海峽中線...",
    "url": "https://www.cna.com.tw/news/aipl/202603080001.aspx",
    "category": "military",
    "impactLevel": 8
  },
  {
    "date": "2026-03-10",
    "title": "中國宣布新一波農產品禁令",
    "description": "中國海關總署宣布暫停進口台灣某農產品...",
    "url": "https://news.ltn.com.tw/news/politics/breakingnews/1234567",
    "category": "economic",
    "impactLevel": 5
  }
]`;

  const ai = new GoogleGenAI({ apiKey: cleanApiKey });
  try {
    const response = await executeWithLock(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }), isPaidKey);

    const text = response.text || '[]';
    const parsedData = JSON.parse(text);
    const eventsArray = Array.isArray(parsedData) ? parsedData : (parsedData.events || []);
    
    setLocalCache(cacheKey, eventsArray);
    return eventsArray as TimelineEvent[];
  } catch (error) {
    console.error("Error fetching timeline events:", error);
    return [];
  }
}

export async function fetchMapData(customApiKey?: string, forceRefresh = false, isPaidKey = false): Promise<MapData | null> {
  const cleanApiKey = customApiKey?.trim().replace(/[\s\uFEFF\xA0]/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanApiKey) return null;

  const cacheKey = `map_data_${cleanApiKey || 'default'}`;
  
  if (!forceRefresh) {
    const cachedData = getLocalCache(cacheKey);
    if (cachedData) {
      return cachedData as MapData;
    }
  }

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const todayStr = getTaipeiDateString(0);
  const yesterdayStr = getTaipeiDateString(-1);
  const tomorrowStr = getTaipeiDateString(1);

  const prompt = `現在精確時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是搜尋「國防部 臺海周邊海、空域動態」的「當日（台灣時間 ${todayStr} 00:00 至 23:59）、即時」最新發布資料，以及中國海事局最新的「航行警告 / 禁航區 / 演習」公告。

【🔴 絕對強制指令 🔴】：
1. 搜尋策略：請搜尋 "${todayStr} 國防部 臺海周邊海 空域動態"，強制獲取當日發布的資料。並強制加上 "after:${yesterdayStr} before:${tomorrowStr}" 參數，以確保搜尋引擎只回傳當日的結果。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${todayStr} 當日）的來源需「嚴格全部捨棄」，絕對不可採用。
3. 時間合理性（極度重要）：資料的 \`updateTime\` 絕對不可以超過現在的系統時間 \`${now}\`。如果當日（${todayStr}）的資料尚未發布（例如現在時間早於 09:00），請將所有數值填 0，並將 \`updateTime\` 設為 "尚未發布"，絕對禁止捏造未來的時間或數據。
4. 必須回傳純 JSON 格式，絕對不要包含 Markdown 語法 (如 \`\`\`json) 或其他文字。

JSON 格式範例與說明：
{
  "surveillance": {
    "updateTime": "2026/03/13 06:00", // 官方發布時間或資料截止時間
    "aircraftTotal": 15, // 偵獲共機總數
    "aircraftCrossed": 10, // 逾越海峽中線及進入西南空域數
    "shipsTotal": 6, // 偵獲共艦總數
    "officialShips": 2, // 公務船總數
    "targets": [ // 根據數量隨機生成合理的經緯度座標 (台灣周邊，lat: 21~26, lng: 119~123)
      { "id": 1, "lat": 24.5, "lng": 119.5, "type": "aircraft", "heading": 90 },
      { "id": 2, "lat": 22.5, "lng": 120.5, "type": "ship", "heading": 180 }
    ]
  },
  "exerciseZones": [ // 若無最新禁航區，可回傳空陣列 []
    {
      "name": "海空聯合戰備警巡",
      "time": "2026/03/10 12:00 - 03/15 12:00",
      "type": "實彈射擊、海空封控",
      "coordinates": [ // 禁航區的多邊形座標
        [25.25, 120.23], [25.25, 120.85], [24.83, 120.85], [24.83, 120.23]
      ]
    }
  ]
}`;

  const ai = new GoogleGenAI({ apiKey: cleanApiKey });
  try {
    const response = await executeWithLock(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }), isPaidKey);

    const text = response.text || '{}';
    const parsedData = JSON.parse(text);
    
    // Ensure targets have IDs and valid types
    if (parsedData.surveillance && Array.isArray(parsedData.surveillance.targets)) {
      parsedData.surveillance.targets = parsedData.surveillance.targets.map((t: any, i: number) => ({
        ...t,
        id: t.id || i + 1,
        type: ['aircraft', 'ship', 'fishing'].includes(t.type) ? t.type : 'ship'
      }));
    }

    setLocalCache(cacheKey, parsedData);
    return parsedData as MapData;
  } catch (error) {
    console.error("Error fetching map data:", error);
    return null;
  }
}
