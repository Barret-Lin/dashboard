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

export async function executeWithLock<T>(task: () => Promise<T>): Promise<T> {
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

export async function fetchIntelligence(categoryId: string, categoryQuery: string, customApiKey?: string, forceRefresh = false): Promise<IntelligenceData> {
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

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekStr = lastWeek.toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  let prompt = '';
  if (categoryId === 'new_threat') {
    prompt = `現在時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是彙整「今日（${todayStr}）或過去 24 小時內」關於中國對台灣的最新動態與新聞。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月"，並強烈建議加上 "when:1d" 或 "after:${yesterdayStr}"。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布日期。任何超過 24 小時前發布的新聞、舊事件，必須「直接丟棄」，絕對不可寫入報告，也不可作為 Verified Sources。
3. 寧缺勿濫：如果搜尋後發現「沒有」過去 24 小時內的最新重大消息，請直接回答「過去 24 小時無重大事件」，絕對不允許拿舊新聞來湊數。
4. 連結正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果，不要自己發明或猜測網址。

請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：請分析並列出最近 24 小時內與台海相關的重大「軍事」、「經濟」、「外交」或「認知作戰」的事件。
   - 格式：請具體寫出時間點與消息來源，並「強制標示該新聞的發布日期」（例如：根據 CNN 於 YYYY-MM-DD 的報導）。
   - 警告：「絕對不要」在內文中產生任何 Markdown 網址連結（例如 [CNN 報導](https://...)），因為系統會自動在底部附上真實的來源連結。
2. **威脅評估**：分析這些行動對台灣的整體影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  } else {
    prompt = `現在時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是彙整「過去一週內（${lastWeekStr} 至今）」關於中國對台灣的「${categoryQuery}」最新動態與新聞。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月"，並強烈建議加上 "when:7d" 或 "after:${lastWeekStr}"。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布日期。任何超過一週前（${lastWeekStr} 之前）發布的新聞、舊事件（如 2024 年的軍演、舊的選舉新聞等），必須「直接丟棄」，絕對不可寫入報告，也不可作為 Verified Sources。若非一週內的資料，請勿納入評估。
3. 寧缺勿濫：如果搜尋後發現「沒有」過去一週內的最新重大消息，請直接回答「過去一週無重大事件」，絕對不允許拿舊新聞來湊數。
4. 連結正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果，不要自己發明或猜測網址。

請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：列出具體事件。
   - 格式：請具體寫出時間點與消息來源，並「強制標示該新聞的發布日期」（例如：根據 CNN 於 YYYY-MM-DD 的報導）。
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
    }));

    const text = response.text || '';
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const sources = groundingChunks
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

export async function fetchOverallThreatLevel(customApiKey?: string, forceRefresh = false): Promise<ThreatLevelData> {
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

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const todayStr = new Date().toISOString().split('T')[0];
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekStr = lastWeek.toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const prompt = `現在時間是台灣時間 ${now} (YYYY-MM-DD: ${todayStr})。
請嚴格搜尋「過去一週內（${lastWeekStr} 至今）」關於台海局勢的新聞（包含國內外媒體及社群網路），評估目前的整體威脅等級。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月"，並強烈建議加上 "when:7d" 或 "after:${lastWeekStr}"。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布日期。任何超過一週前（${lastWeekStr} 之前）發布的新聞、舊事件（如 2024 年的軍演、舊的選舉新聞等），必須「直接丟棄」，絕對不可作為評分依據，也不可作為 Verified Sources。若非一週內的資料，請勿納入評估。
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
    }));

    const text = response.text || '{}';
    let parsedData;
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse JSON response:", text);
      throw new Error("Invalid JSON response from API");
    }

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = groundingChunks
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
