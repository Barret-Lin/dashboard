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

export type ModelVersion = 'gemini-3.1-pro-preview' | 'gemini-3-flash-preview' | 'gemini-2.5-flash';

export interface ApiStatus {
  currentModel: ModelVersion;
  quotaStatus: 'NORMAL' | 'RATE_LIMIT' | 'DAILY_LIMIT' | 'INVALID' | 'ERROR';
  lastErrorMsg?: string;
  currentApiKey?: string;
}

let currentApiStatus: ApiStatus = {
  currentModel: 'gemini-3.1-pro-preview',
  quotaStatus: 'NORMAL'
};

const statusListeners: ((status: ApiStatus) => void)[] = [];

export function subscribeToApiStatus(listener: (status: ApiStatus) => void) {
  statusListeners.push(listener);
  listener(currentApiStatus);
  return () => {
    const index = statusListeners.indexOf(listener);
    if (index > -1) statusListeners.splice(index, 1);
  };
}

export function updateApiStatus(updates: Partial<ApiStatus>) {
  currentApiStatus = { ...currentApiStatus, ...updates };
  statusListeners.forEach(l => l(currentApiStatus));
}

export function getApiStatus() {
  return currentApiStatus;
}

export async function generateContentWithFallback(ai: GoogleGenAI, contents: any, config: any) {
  const models: ModelVersion[] = ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
  
  let startIndex = models.indexOf(currentApiStatus.currentModel);
  if (startIndex === -1) startIndex = 0;

  let lastError: any = null;

  for (let i = startIndex; i < models.length; i++) {
    const model = models[i];
    try {
      if (currentApiStatus.currentModel !== model) {
        updateApiStatus({ currentModel: model });
      }
      
      // Clean up config to avoid empty tools
      const cleanConfig = { ...config };
      if (cleanConfig.tools && Array.isArray(cleanConfig.tools)) {
        cleanConfig.tools = cleanConfig.tools.filter((t: any) => Object.keys(t).length > 0);
        if (cleanConfig.tools.length === 0) {
          delete cleanConfig.tools;
        }
      }
      
      const response = await ai.models.generateContent({
        model,
        contents,
        config: cleanConfig
      });
      
      updateApiStatus({ quotaStatus: 'NORMAL', lastErrorMsg: undefined });
      return response;
      
    } catch (error: any) {
      console.error(`Error with model ${model}:`, error);
      lastError = error;
      const errorMsg = error?.message || String(error);
      
      // Check if it's a quota error
      const isQuotaError = errorMsg.includes('429') || 
                           errorMsg.includes('quota') || 
                           errorMsg.includes('rate limit') ||
                           errorMsg.includes('exhausted');
                           
      const isInvalidKey = errorMsg.includes('403') || 
                           errorMsg.includes('API_KEY_INVALID') || 
                           errorMsg.includes('API key not valid');
                           
      if (isInvalidKey) {
        updateApiStatus({ quotaStatus: 'INVALID', lastErrorMsg: errorMsg });
        throw error; // Don't fallback for invalid key
      }
      
      if (isQuotaError) {
        if (i < models.length - 1) {
          console.log(`Downgrading model from ${model} to ${models[i+1]}`);
          continue; // Try next model
        } else {
          updateApiStatus({ quotaStatus: 'RATE_LIMIT', lastErrorMsg: errorMsg });
          throw error; // All models failed
        }
      }
      
      // For 400 Bad Request or other errors, don't fallback, just throw
      updateApiStatus({ quotaStatus: 'ERROR', lastErrorMsg: errorMsg });
      throw error;
    }
  }
  
  throw lastError || new Error("All models failed");
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

function getLocalDateString(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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

export function clearDataCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('intel_') || key.startsWith('threat_') || key.startsWith('timeline_') || key.startsWith('map_data_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
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

  const now = new Date().toLocaleString('zh-TW', { hour12: false });
  const todayStr = getLocalDateString(0);
  const yesterdayStr = getLocalDateString(-1);
  const tomorrowStr = getLocalDateString(1);
  const oneWeekAgoStr = getLocalDateString(-7);
  
  const d = new Date();
  const currentYear = d.getFullYear();
  const currentMonth = d.getMonth() + 1;

  let prompt = '';
  if (categoryId === 'new_threat') {
    prompt = `現在精確時間是當地時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是彙整「當日（當地時間 ${todayStr} 00:00 至 23:59）」關於中國對台灣的最新動態與新聞。
【注意】：已取消「過去24小時」的定義，請嚴格只抓取「當日」的資料。

【深度檢索與引用規範】執行時請遵守以下步驟：
1. 搜尋來源：僅限使用官方網站、學術論文或知名新聞媒體的資料。
2. 摘錄內容：針對每個關鍵論點，先引用原始網頁中的一段話（不超過10個字）。
3. 標註連結：在引用後方提供完整的「日期＋媒體名稱」的超連結。
   - ⚠️ 極度重要：你必須「完全精確複製」Google Search 結果 (Grounding Sources) 中提供的真實 URL。
   - ⚠️ 絕對禁止：嚴禁自行拼湊、猜測、或修改網址。如果搜尋結果中沒有直接連結，請直接註明【資料不足，無法確認】。
   - ⚠️ 格式要求：請務必將超連結放在引號「」的外面，絕對不要把引號或引言包進超連結中。正確格式：...「引用不超過10字」 [2026-03-14 中央社](https://www.cna.com.tw/...)。
4. 最終校核：在輸出前，請再次檢查該連結是否存在於你的檢索結果中。絕對禁止虛妄連結。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月" 以及日期 "${todayStr}"，並強制加上 "after:${yesterdayStr} before:${tomorrowStr}" 參數，以確保搜尋引擎只回傳當日的結果。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${todayStr} 當日）的來源需「嚴格全部捨棄」，絕對不可寫入報告，也不可作為 Verified Sources。
3. 寧缺勿濫：如果搜尋後發現「沒有」當日的最新重大消息，請直接回答「當日無重大事件」，絕對不允許拿舊新聞來湊數。
4. 來源正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果。

請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：請分析並列出當日與台海相關的重大「軍事」、「經濟」、「外交」或「認知作戰」的事件。
   - 格式：請具體寫出時間點與消息來源，並「強制標示該新聞的發布日期與時間」。
   - 連結強制要求：請務必將超連結放在引號「」的外面，絕對不要把引號或引言包進超連結中。正確格式：...「引用不超過10字」 [2026-03-14 中央社](https://www.cna.com.tw/...)。
   - 唯一性要求：每一條引用必須對應其「專屬」的原始網頁連結。嚴禁多個不同來源指向同一個網址。如果你引用了三個不同的媒體，就必須提供三個不同的真實網址。
2. **威脅評估**：分析這些行動對台灣的整體影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  } else {
    prompt = `現在精確時間是當地時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是彙整「過去一週（當地時間 ${oneWeekAgoStr} 至 ${todayStr}）」關於中國對台灣的「${categoryQuery}」最新動態與新聞。

【深度檢索與引用規範】執行時請遵守以下步驟：
1. 搜尋來源：僅限使用官方網站、學術論文或知名新聞媒體的資料。
2. 摘錄內容：針對每個關鍵論點，先引用原始網頁中的一段話（不超過10個字）。
3. 標註連結：在引用後方提供完整的「日期＋媒體名稱」的超連結。
   - ⚠️ 極度重要：你必須「完全精確複製」Google Search 結果 (Grounding Sources) 中提供的真實 URL。
   - ⚠️ 絕對禁止：嚴禁自行拼湊、猜測、或修改網址。如果搜尋結果中沒有直接連結，請直接註明【資料不足，無法確認】。
   - ⚠️ 格式要求：請務必將超連結放在引號「」的外面，絕對不要把引號或引言包進超連結中。正確格式：...「引用不超過10字」 [2026-03-14 中央社](https://www.cna.com.tw/...)。
4. 最終校核：在輸出前，請再次檢查該連結是否存在於你的檢索結果中。絕對禁止虛妄連結。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含年份 "${currentYear}" 與月份 "${currentMonth}月" 以及日期 "${todayStr}"，並強制加上 "after:${oneWeekAgoStr} before:${tomorrowStr}" 參數，確保只獲取過去一週的資料。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${oneWeekAgoStr} 至 ${todayStr}）的來源需「嚴格全部捨棄」，絕對不可寫入報告，也不可作為 Verified Sources。
3. 寧缺勿濫：如果搜尋後發現「沒有」過去一週的最新重大消息，請直接回答「過去一週無重大事件」，絕對不允許拿舊新聞來湊數。
4. 來源正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果。

請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：列出具體事件。
   - 格式：請具體寫出時間點與消息來源，並「強制標示該新聞的發布日期與時間」。
   - 連結強制要求：請務必將超連結放在引號「」的外面，絕對不要把引號或引言包進超連結中。正確格式：...「引用不超過10字」 [2026-03-14 中央社](https://www.cna.com.tw/...)。
   - 唯一性要求：每一條引用必須對應其「專屬」的原始網頁連結。嚴禁多個不同來源指向同一個網址。如果你引用了三個不同的媒體，就必須提供三個不同的真實網址。
2. **威脅評估**：分析這些行動對台灣的影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  }

  let lastError: any = null;

  const ai = new GoogleGenAI({ apiKey: cleanApiKey });
  try {
    const response = await executeWithLock(() => generateContentWithFallback(ai, prompt, {
      tools: [{ googleSearch: {} }],
      temperature: 0.1,
    }), isPaidKey);

    const text = response.text || '';
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];
    const groundingSupports = groundingMetadata?.groundingSupports || [];

    const allSources = groundingChunks
      .map((chunk: any) => ({
        title: chunk.web?.title || '未知來源',
        uri: chunk.web?.uri || '',
      }))
      .filter((s: any) => s.uri);

    const usedChunkIndices = new Set<number>();
    if (groundingSupports.length > 0) {
      groundingSupports.forEach((support: any) => {
        if (support.groundingChunkIndices) {
          support.groundingChunkIndices.forEach((index: number) => usedChunkIndices.add(index));
        }
      });
    } else {
      // Fallback: if no supports are provided, assume all chunks are used
      groundingChunks.forEach((_: any, index: number) => usedChunkIndices.add(index));
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
    const uniqueAllSources = Array.from(new Map(allSources.map((s: any) => [s.uri, s])).values()) as { title: string; uri: string }[];

    let processedText = text;
    
    // 5. 落實防偽超連結驗證機制 (100% 精確匹配版：嚴格語意與網域對應)
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    
    const availableChunks = groundingChunks.map((c: any, index: number) => ({
      index,
      uri: c.web?.uri || '',
      title: (c.web?.title || '').toLowerCase(),
      domain: c.web?.uri ? new URL(c.web.uri).hostname.toLowerCase().replace(/^www\./, '') : ''
    })).filter((c: any) => c.uri);

    const aliases: Record<string, string> = {
      // 台灣 (Taiwan)
      '中央社': 'cna.com.tw',
      '聯合報': 'udn.com',
      '聯合新聞網': 'udn.com',
      '經濟日報': 'money.udn.com',
      '中時': 'chinatimes.com',
      '中國時報': 'chinatimes.com',
      '工商時報': 'ctee.com.tw',
      '自由時報': 'ltn.com.tw',
      '自由': 'ltn.com.tw',
      '新頭殼': 'newtalk.tw',
      'newtalk': 'newtalk.tw',
      '風傳媒': 'storm.mg',
      '東森': 'ettoday.net',
      'ettoday': 'ettoday.net',
      'tvbs': 'tvbs.com.tw',
      '三立': 'setn.com',
      '民視': 'ftvnews.com.tw',
      '公視': 'pts.org.tw',
      '華視': 'cts.com.tw',
      '台視': 'ttv.com.tw',
      '中視': 'ctv.com.tw',
      '大紀元': 'epochtimes.com',
      '太報': 'taisounds.com',
      '上報': 'upmedia.mg',
      '信傳媒': 'cmmedia.com.tw',
      '鏡週刊': 'mirrormedia.mg',
      '天下': 'cw.com.tw',
      '今周刊': 'businesstoday.com.tw',
      '商業周刊': 'businessweekly.com.tw',
      '遠見': 'gvm.com.tw',
      '中央廣播電臺': 'rti.org.tw',
      '央廣': 'rti.org.tw',
      '端傳媒': 'theinitium.com',
      '報導者': 'twreporter.org',
      '關鍵評論網': 'thenewslens.com',
      '壹蘋': 'tw.nextapple.com',
      '壹蘋新聞網': 'tw.nextapple.com',
      'yahoo': 'yahoo.com',
      'line': 'today.line.me',
      'msn': 'msn.com',
      'google': 'news.google.com',

      // 中國大陸及港澳星馬 (China, HK, Macau, Singapore, Malaysia)
      '新華社': 'xinhuanet.com',
      '新華網': 'news.cn',
      '央視': 'cctv.com',
      '環球網': 'huanqiu.com',
      '環球時報': 'globaltimes.cn',
      '解放軍報': '81.cn',
      '中國軍網': '81.cn',
      '國防部': 'mnd.gov.tw',
      '中國國防部': 'mod.gov.cn',
      '海事局': 'msa.gov.cn',
      '外交部': 'mfa.gov.cn',
      '人民網': 'people.com.cn',
      '人民日報': 'people.com.cn',
      '中國日報': 'chinadaily.com.cn',
      '中新社': 'chinanews.com.cn',
      '中新網': 'chinanews.com.cn',
      '新浪': 'sina.com.cn',
      '騰訊': 'qq.com',
      '網易': '163.com',
      '搜狐': 'sohu.com',
      '鳳凰網': 'ifeng.com',
      '觀察者網': 'guancha.cn',
      '中評社': 'crntt.com',
      '南華早報': 'scmp.com',
      '星島': 'stheadline.com',
      '明報': 'mingpao.com',
      '大公報': 'takungpao.com',
      '文匯報': 'wenweipo.com',
      '香港電台': 'rthk.hk',
      '海峽時報': 'straitstimes.com',
      '聯合早報': 'zaobao.com.sg',
      '星洲日報': 'sinchew.com.my',

      // 美國 (USA)
      '路透': 'reuters.com',
      '彭博': 'bloomberg.com',
      '華爾街日報': 'wsj.com',
      '紐約時報': 'nytimes.com',
      'cnn': 'cnn.com',
      'washington post': 'washingtonpost.com',
      '華盛頓郵報': 'washingtonpost.com',
      '美聯社': 'apnews.com',
      '美國之音': 'voachinese.com',
      'voa': 'voanews.com',
      '自由亞洲': 'rfa.org',
      'rfa': 'rfa.org',
      'fox news': 'foxnews.com',
      '福斯新聞': 'foxnews.com',
      'msnbc': 'msnbc.com',
      'cnbc': 'cnbc.com',
      'abc news': 'abcnews.go.com',
      'cbs news': 'cbsnews.com',
      'nbc news': 'nbcnews.com',
      'time': 'time.com',
      '時代雜誌': 'time.com',
      'newsweek': 'newsweek.com',
      '新聞週刊': 'newsweek.com',
      'politico': 'politico.com',
      'axios': 'axios.com',
      'npr': 'npr.org',
      'pbs': 'pbs.org',
      '洛杉磯時報': 'latimes.com',
      '芝加哥論壇報': 'chicagotribune.com',
      '今日美國': 'usatoday.com',

      // 歐洲與英國 (Europe & UK)
      'bbc': 'bbc.com',
      '金融時報': 'ft.com',
      '衛報': 'theguardian.com',
      'the guardian': 'theguardian.com',
      '泰晤士報': 'thetimes.co.uk',
      'the times': 'thetimes.co.uk',
      '每日電訊報': 'telegraph.co.uk',
      '獨立報': 'independent.co.uk',
      '天空新聞': 'news.sky.com',
      '法新社': 'afp.com',
      '法廣': 'rfi.fr',
      'rfi': 'rfi.fr',
      '世界報': 'lemonde.fr',
      'le monde': 'lemonde.fr',
      '費加洛報': 'lefigaro.fr',
      'le figaro': 'lefigaro.fr',
      '法國24': 'france24.com',
      'france 24': 'france24.com',
      '路透社': 'reuters.com',

      // 德國 (Germany)
      'dw': 'dw.com',
      '德國之聲': 'dw.com',
      '明鏡': 'spiegel.de',
      'der spiegel': 'spiegel.de',
      '法蘭克福匯報': 'faz.net',
      'faz': 'faz.net',
      '南德日報': 'sueddeutsche.de',
      'sz': 'sueddeutsche.de',
      '世界報 (德國)': 'welt.de',
      'die welt': 'welt.de',
      '商報': 'handelsblatt.com',
      '圖片報': 'bild.de',

      // 義大利 (Italy)
      '晚郵報': 'corriere.it',
      'corriere della sera': 'corriere.it',
      '共和報': 'repubblica.it',
      'la repubblica': 'repubblica.it',
      '安莎通訊社': 'ansa.it',
      'ansa': 'ansa.it',
      '24小時太陽報': 'ilsole24ore.com',
      '新聞報': 'lastampa.it',
      'la stampa': 'lastampa.it',

      // 俄羅斯 (Russia)
      '塔斯社': 'tass.com',
      'tass': 'tass.com',
      '今日俄羅斯': 'rt.com',
      'rt': 'rt.com',
      '衛星通訊社': 'sputniknews.com',
      'sputnik': 'sputniknews.com',
      '俄新社': 'ria.ru',
      '莫斯科時報': 'themoscowtimes.com',
      '生意人報': 'kommersant.ru',
      '消息報': 'iz.ru',

      // 日本 (Japan)
      '共同社': 'kyodonews.net',
      '日經': 'nikkei.com',
      '日本經濟新聞': 'nikkei.com',
      '讀賣': 'yomiuri.co.jp',
      '讀賣新聞': 'yomiuri.co.jp',
      '朝日': 'asahi.com',
      '朝日新聞': 'asahi.com',
      '產經': 'sankei.com',
      '產經新聞': 'sankei.com',
      'nhk': 'nhk.or.jp',
      '每日新聞': 'mainichi.jp',
      '日本時報': 'japantimes.co.jp',
      'japan times': 'japantimes.co.jp',

      // 聯合國及國際組織 (UN & International Organizations)
      '聯合國': 'news.un.org',
      'un news': 'news.un.org',
      '世界衛生組織': 'who.int',
      'who': 'who.int',
      '世界貿易組織': 'wto.org',
      'wto': 'wto.org',
      '國際貨幣基金': 'imf.org',
      'imf': 'imf.org',
      '世界銀行': 'worldbank.org',
      'world bank': 'worldbank.org',
      '聯合國兒童基金會': 'unicef.org',
      'unicef': 'unicef.org',
      '聯合國教科文組織': 'unesco.org',
      'unesco': 'unesco.org',
      '聯合國難民署': 'unhcr.org',
      'unhcr': 'unhcr.org',
      '國際原子能總署': 'iaea.org',
      'iaea': 'iaea.org',
      '北約': 'nato.int',
      'nato': 'nato.int',
      '歐盟': 'europa.eu',
      'eu': 'europa.eu'
    };

    const usedUris = new Set<string>();

    const normalizeUrl = (u: string) => {
      try {
        const parsed = new URL(u);
        return parsed.origin + parsed.pathname.replace(/\/$/, '');
      } catch {
        return u.split('?')[0].replace(/\/$/, '');
      }
    };

    processedText = processedText.replace(markdownLinkRegex, (match, linkText, url, offset) => {
      const cleanUrl = url.trim();
      const cleanUrlNorm = normalizeUrl(cleanUrl);
      let aiDomain = '';
      try { aiDomain = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch(e) {}

      let prefix = '';
      let actualLinkText = linkText;
      
      // 修正 AI 將引號或部分引言包進超連結的錯誤格式
      const malformedMatch = linkText.match(/^(.*?[」】"']\s*)(.+)$/);
      if (malformedMatch) {
        prefix = malformedMatch[1];
        actualLinkText = malformedMatch[2];
      }

      const pubLower = actualLinkText.toLowerCase();
      const parts = actualLinkText.trim().split(/\s+/);
      const publisherName = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : pubLower;

      // 1. 尋找與此引言相關的 Grounding Support (局部搜尋)
      const localChunkIndices = new Set<number>();
      
      // 優先尋找直接覆蓋超連結，或在超連結前方 50 字元內結束的 support
      groundingSupports.forEach((support: any) => {
        const sStart = support.segment?.startIndex || 0;
        const sEnd = support.segment?.endIndex || 0;
        if ((sStart <= offset && sEnd >= offset) || (sEnd <= offset && offset - sEnd <= 50)) {
          const indices = support.groundingChunkIndices || [];
          indices.forEach((i: number) => localChunkIndices.add(i));
        }
      });

      // 如果找不到，放寬到前方 150 字元
      if (localChunkIndices.size === 0) {
        groundingSupports.forEach((support: any) => {
          const sStart = support.segment?.startIndex || 0;
          const sEnd = support.segment?.endIndex || 0;
          if (sEnd <= offset && offset - sEnd <= 150) {
            const indices = support.groundingChunkIndices || [];
            indices.forEach((i: number) => localChunkIndices.add(i));
          }
        });
      }

      const candidateIndices = Array.from(localChunkIndices);
      const candidateChunks = candidateIndices.map(i => availableChunks.find(c => c.index === i)).filter(Boolean) as any[];

      let matchedUri = null;
      let matchedChunk = null;

      // 策略 1: 網址完全命中全局清單 (AI 寫對了真實網址)
      matchedChunk = availableChunks.find(c => normalizeUrl(c.uri) === cleanUrlNorm);

      // 策略 2: 從 Local Chunks 中尋找 (基於 Grounding 的真實來源)
      if (!matchedChunk && candidateChunks.length > 0) {
        // 透過媒體別名對應網域
        for (const [key, domain] of Object.entries(aliases)) {
          if (pubLower.includes(key)) {
            matchedChunk = candidateChunks.find(c => c.domain.includes(domain) && !usedUris.has(c.uri)) || candidateChunks.find(c => c.domain.includes(domain));
            if (matchedChunk) break;
          }
        }
        // 透過媒體名稱直接出現在 Chunk 標題中
        if (!matchedChunk && publisherName.length > 1) {
          matchedChunk = candidateChunks.find(c => c.title.includes(publisherName) && !usedUris.has(c.uri)) || candidateChunks.find(c => c.title.includes(publisherName));
        }
        // 透過 AI 提供的網域確實存在於候選清單中
        if (!matchedChunk && aiDomain) {
          matchedChunk = candidateChunks.find(c => (c.domain.includes(aiDomain) || aiDomain.includes(c.domain)) && !usedUris.has(c.uri)) || candidateChunks.find(c => c.domain.includes(aiDomain) || aiDomain.includes(c.domain));
        }
      }

      // 策略 3: 如果沒有 Local Chunks，回退到全局搜尋 (只用強匹配)
      if (!matchedChunk) {
         for (const [key, domain] of Object.entries(aliases)) {
           if (pubLower.includes(key)) {
             matchedChunk = availableChunks.find(c => c.domain.includes(domain) && !usedUris.has(c.uri)) || availableChunks.find(c => c.domain.includes(domain));
             if (matchedChunk) break;
           }
         }
         if (!matchedChunk && publisherName.length > 1) {
           matchedChunk = availableChunks.find(c => c.title.includes(publisherName) && !usedUris.has(c.uri)) || availableChunks.find(c => c.title.includes(publisherName));
         }
         if (!matchedChunk && aiDomain) {
           matchedChunk = availableChunks.find(c => (c.domain.includes(aiDomain) || aiDomain.includes(c.domain)) && !usedUris.has(c.uri)) || availableChunks.find(c => c.domain.includes(aiDomain) || aiDomain.includes(c.domain));
         }
      }

      // 嚴格把關：如果找不到任何匹配的真實來源，絕對不產生超連結
      if (matchedChunk) {
        matchedUri = matchedChunk.uri;
        usedUris.add(matchedUri);
        return `${prefix}[${actualLinkText}](${matchedUri})`;
      } else {
        return `${prefix}${actualLinkText}`;
      }
    });

    const result = {
      text: processedText,
      sources: uniqueSources,
      timestamp: Date.now(),
    };
    setLocalCache(cacheKey, result);
    return result;
  } catch (error: any) {
    lastError = error;

    const errorMsg = error?.message || String(error);
    const isRateLimited = errorMsg.includes('429') || error?.status === 429;
    const isDailyLimit = errorMsg.includes('quota') || errorMsg.includes('Resource has been exhausted');
    const isInvalidKey = errorMsg.includes('403') || errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID');
    
    if (!isRateLimited && !isDailyLimit && !isInvalidKey) {
      console.error("Error fetching intelligence:", error);
    }
    
    return {
      text: `⚠️ **無法取得資料**\n\n${isDailyLimit ? '已達每日 API 請求上限，請於太平洋時間午夜後重試。' : isRateLimited ? '已達每分鐘 API 請求上限，請稍後再試。' : isInvalidKey ? 'API 金鑰無效，請檢查您的設定。' : `發生錯誤：${errorMsg}`}`,
      sources: [],
      isRateLimited: isRateLimited || isDailyLimit,
      isDailyLimit,
      isInvalidKey
    };
  }
}

export async function fetchOverallThreatLevel(
  customApiKey?: string, 
  forceRefresh = false, 
  isPaidKey = false,
  weights = { military: 60, economic: 20, diplomatic: 10, cognitive: 10 }
): Promise<ThreatLevelData> {
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

  const now = new Date().toLocaleString('zh-TW', { hour12: false });
  const todayStr = getLocalDateString(0);
  const yesterdayStr = getLocalDateString(-1);
  const tomorrowStr = getLocalDateString(1);
  
  const d = new Date();
  const currentYear = d.getFullYear();
  const currentMonth = d.getMonth() + 1;

  const prompt = `現在精確時間是當地時間 ${now} (YYYY-MM-DD: ${todayStr})。
請嚴格搜尋「當日（台灣時間 ${todayStr} 00:00 至 23:59）」關於台海局勢的新聞（包含國內外媒體及社群網路），評估目前的整體威脅等級。

【🔴 絕對強制指令 - 違反將導致系統錯誤 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，搜尋關鍵字「必須」包含 "台海" 或 "國防部" 或 "共機"，並強制加上 "after:${yesterdayStr} before:${tomorrowStr}" 參數，確保只獲取當日的資料。
2. 來源審查（極度重要）：在閱讀搜尋結果時，請「嚴格檢查」每篇文章的發布精確時間。不在定義抓取資料時間週期內（非 ${todayStr} 當日）的來源需「嚴格全部捨棄」，絕對不可作為評分依據，也不可作為 Verified Sources。
3. 連結正確性：系統會自動抓取你參考的網頁作為 Verified Sources。請確保你只依賴「真實存在、且為最新發布」的搜尋結果。

請依據以下四個面向給予 0~100 的威脅評分，並套用權重計算總分 (Total Score)：
1. 軍事動態 (Military) - 權重 ${weights.military}%
2. 經濟封鎖 (Economic) - 權重 ${weights.economic}%
3. 外交打壓 (Diplomatic) - 權重 ${weights.diplomatic}%
4. 認知作戰 (Cognitive) - 權重 ${weights.cognitive}%

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
    const response = await executeWithLock(() => generateContentWithFallback(ai, prompt, {
      tools: [{ googleSearch: {} }],
      temperature: 0.1,
      responseMimeType: 'application/json',
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

    const allSources = groundingChunks
      .map((chunk: any) => ({
        title: chunk.web?.title || '未知來源',
        uri: chunk.web?.uri || '',
      }))
      .filter((s: any) => s.uri);

    const usedChunkIndices = new Set<number>();
    if (groundingSupports.length > 0) {
      groundingSupports.forEach((support: any) => {
        if (support.groundingChunkIndices) {
          support.groundingChunkIndices.forEach((index: number) => usedChunkIndices.add(index));
        }
      });
    } else {
      groundingChunks.forEach((_: any, index: number) => usedChunkIndices.add(index));
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
    const errorMsg = error?.message || String(error);
    const isRateLimited = errorMsg.includes('429') || error?.status === 429;
    const isDailyLimit = errorMsg.includes('quota') || errorMsg.includes('Resource has been exhausted');
    const isInvalidKey = errorMsg.includes('403') || errorMsg.includes('API key not valid') || errorMsg.includes('API_KEY_INVALID');
    
    if (!isRateLimited && !isDailyLimit && !isInvalidKey) {
      console.error("Error fetching threat level:", error);
    }
    
    return {
      level: 'UNKNOWN' as any,
      totalScore: 0,
      summary: isDailyLimit ? '已達每日 API 請求上限' : isRateLimited ? '已達每分鐘 API 請求上限' : isInvalidKey ? 'API 金鑰無效' : `發生錯誤：${errorMsg}`,
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

  const now = new Date().toLocaleString('zh-TW', { hour12: false });
  const todayStr = getLocalDateString(0);
  
  // 過去一週：自網頁載入時間起算或手動更新頁面開始起算七日
  const lastWeekDate = new Date();
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeekStr = lastWeekDate.toLocaleString('zh-TW', { hour12: false });

  const prompt = `現在精確時間是當地時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是搜尋「過去一週（當地時間 ${lastWeekStr} 至 ${now}）」關於台海局勢的重大新聞與事件。

【🔴 絕對強制指令 🔴】：
1. 搜尋策略：你呼叫 Google Search 工具時，必須搜尋過去一週內關於台海軍事、經濟、外交、認知作戰的真實重大事件。
2. 請嚴格回傳 JSON 格式，不要包含 Markdown 語法或額外文字。
3. 請確保事件按時間先後順序排列（最舊的在前面，最新的在後面）。
4. 每個事件必須評估其影響力等級 (impactLevel)，範圍為 1 到 10 的整數（10 為最高威脅/影響）。
5. 取消超連結，保留純文字描述即可。

JSON 格式範例：
[
  {
    "date": "2026-03-08",
    "title": "國防部偵獲多架次共機越過海峽中線",
    "description": "國防部今日表示，自上午起陸續偵獲多架次共機出海活動，其中部分逾越海峽中線及其延伸線...",
    "category": "military",
    "impactLevel": 8
  }
]`;

  const ai = new GoogleGenAI({ apiKey: cleanApiKey });
  try {
    const response = await executeWithLock(() => generateContentWithFallback(ai, prompt, {
      tools: [{ googleSearch: {} }],
      temperature: 0.1,
      responseMimeType: 'application/json',
    }), isPaidKey);

    const text = response.text || '[]';
    const parsedData = JSON.parse(text);
    let eventsArray = Array.isArray(parsedData) ? parsedData : (parsedData.events || []);
    
    eventsArray = eventsArray.map((event: TimelineEvent) => {
      // Clean up markdown links in title if AI generated them
      if (event.title) {
        const mdLinkMatch = event.title.match(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
        if (mdLinkMatch) {
          event.title = mdLinkMatch[1];
        }
      }
      event.url = undefined;
      return event;
    });

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

  const now = new Date().toLocaleString('zh-TW', { hour12: false });
  const todayStr = getLocalDateString(0);
  const yesterdayStr = getLocalDateString(-1);
  const tomorrowStr = getLocalDateString(1);

  const prompt = `現在精確時間是當地時間 ${now} (YYYY-MM-DD: ${todayStr})。
請扮演頂尖的開源情報（OSINT）分析師。你的任務是搜尋「國防部 臺海周邊海、空域動態」的「最新發布資料」，以及中國海事局最新的「航行警告 / 禁航區 / 演習」公告。

【🔴 絕對強制指令 🔴】：
1. 搜尋策略：請搜尋 "國防部 臺海周邊海 空域動態 最新" 或 "國防部發布中共解放軍臺海周邊海、空域動態"，強制獲取國防部「最新一次」發布的官方數據（通常每天早上 9:00 發布前一日 06:00 至當日 06:00 的動態）。
2. 時間合理性：請確保抓取的是「最新一次」的官方公告數據，並將 \`updateTime\` 設為該公告的發布時間或資料截止時間。絕對禁止捏造數據。
3. 必須回傳純 JSON 格式，絕對不要包含 Markdown 語法 (如 \`\`\`json) 或其他文字。

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
    const response = await executeWithLock(() => generateContentWithFallback(ai, prompt, {
      tools: [{ googleSearch: {} }],
      temperature: 0.1,
      responseMimeType: 'application/json',
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
