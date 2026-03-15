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


export function processMarkdownLinks(
  text: string, 
  groundingMetadata: any, 
  usedUris: Set<string> = new Set(), 
  verifiedSources: { title: string; uri: string }[] = []
) {
  if (!text || !groundingMetadata) return { text, sources: verifiedSources, usedUris };

  const groundingChunks = groundingMetadata.groundingChunks || [];
  const groundingSupports = groundingMetadata.groundingSupports || [];

  const availableChunks = groundingChunks.map((c: any, index: number) => ({
    index,
    uri: c.web?.uri || '',
    title: (c.web?.title || '').toLowerCase(),
    domain: c.web?.uri ? new URL(c.web.uri).hostname.toLowerCase().replace(/^www\./, '') : ''
  })).filter((c: any) => c.uri);

  const aliases: Record<string, string> = {
    '中央社': 'cna.com.tw',
    '聯合報': 'udn.com',
    '聯合新聞網': 'udn.com',
    '中時': 'chinatimes.com',
    '中國時報': 'chinatimes.com',
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
    '大紀元': 'epochtimes.com',
    '新華社': 'xinhuanet.com',
    '央視': 'cctv.com',
    '環球網': 'huanqiu.com',
    '解放軍報': '81.cn',
    '國防部': 'mnd.gov.tw',
    '海事局': 'msa.gov.cn',
    '外交部': 'mfa.gov.cn',
    '人民網': 'people.com.cn',
    '新浪': 'sina.com.cn',
    '騰訊': 'qq.com',
    '網易': '163.com',
    '搜狐': 'sohu.com',
    '鳳凰網': 'ifeng.com',
    '觀察者網': 'guancha.cn',
    '中評社': 'crntt.com',
    '海峽時報': 'straitstimes.com',
    '路透': 'reuters.com',
    '彭博': 'bloomberg.com',
    '金融時報': 'ft.com',
    '華爾街日報': 'wsj.com',
    '紐約時報': 'nytimes.com',
    'bbc': 'bbc.com',
    'cnn': 'cnn.com',
    'washington post': 'washingtonpost.com',
    '華盛頓郵報': 'washingtonpost.com',
    'dw': 'dw.com',
    '德國之聲': 'dw.com',
    '法新社': 'afp.com',
    '美聯社': 'apnews.com',
    '共同社': 'kyodonews.net',
    '日經': 'nikkei.com',
    '讀賣': 'yomiuri.co.jp',
    '朝日': 'asahi.com',
    '產經': 'sankei.com',
    '南華早報': 'scmp.com',
    '星島': 'stheadline.com',
    '明報': 'mingpao.com',
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
    '美國之音': 'voachinese.com',
    'voa': 'voanews.com',
    '自由亞洲': 'rfa.org',
    'rfa': 'rfa.org',
    '法廣': 'rfi.fr',
    'rfi': 'rfi.fr',
    '端傳媒': 'theinitium.com',
    '報導者': 'twreporter.org',
    '關鍵評論網': 'thenewslens.com',
    'yahoo': 'yahoo.com',
    'line': 'today.line.me',
    'msn': 'msn.com',
    'google': 'news.google.com',
  };

  const normalizeUrl = (u: string) => {
    try {
      const parsed = new URL(u);
      return parsed.origin + parsed.pathname.replace(/\/$/, '');
    } catch {
      return u.split('?')[0].replace(/\/$/, '');
    }
  };

  const markdownLinkRegex = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  const processedText = text.replace(markdownLinkRegex, (match, linkText, url, offset) => {
    const cleanUrl = url.trim();
    const cleanUrlNorm = normalizeUrl(cleanUrl);
    let aiDomain = '';
    try { aiDomain = new URL(cleanUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch(e) {}

    let prefix = '';
    let actualLinkText = linkText;
    
    const malformedMatch = linkText.match(/^(.*?[」】"']\s*)(.+)$/);
    if (malformedMatch) {
      prefix = malformedMatch[1];
      actualLinkText = malformedMatch[2];
    }

    const pubLower = actualLinkText.toLowerCase();
    const parts = actualLinkText.trim().split(/\s+/);
    const publisherName = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : pubLower;

    const localChunkIndices = new Set<number>();
    groundingSupports.forEach((support: any) => {
      const sStart = support.segment?.startIndex || 0;
      const sEnd = support.segment?.endIndex || 0;
      if ((sStart <= offset && sEnd >= offset) || (sEnd <= offset && offset - sEnd <= 50)) {
        const indices = support.groundingChunkIndices || [];
        indices.forEach((i: number) => localChunkIndices.add(i));
      }
    });

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

    let matchedChunk = null;
    let expectedDomains: string[] = [];
    for (const [key, domain] of Object.entries(aliases)) {
      if (pubLower.includes(key)) {
        expectedDomains.push(domain);
      }
    }

    // 1. 網址完全命中全局清單 (AI 寫對了真實網址)
    const exactUrlMatchGlobal = availableChunks.find(c => normalizeUrl(c.uri) === cleanUrlNorm);
    if (exactUrlMatchGlobal) {
      if (expectedDomains.length > 0) {
        if (expectedDomains.some(d => exactUrlMatchGlobal.domain.includes(d))) {
          matchedChunk = exactUrlMatchGlobal;
        }
      } else {
        matchedChunk = exactUrlMatchGlobal;
      }
    }

    // 2. 從 Local Chunks 或 Global Chunks 中尋找
    if (!matchedChunk) {
      if (expectedDomains.length > 0) {
        // STRICT MODE: 必須符合 expectedDomains
        matchedChunk = candidateChunks.find(c => expectedDomains.some(d => c.domain.includes(d)) && !usedUris.has(c.uri))
                    || candidateChunks.find(c => expectedDomains.some(d => c.domain.includes(d)))
                    || availableChunks.find(c => expectedDomains.some(d => c.domain.includes(d)) && !usedUris.has(c.uri))
                    || availableChunks.find(c => expectedDomains.some(d => c.domain.includes(d)));
      } else {
        // NON-STRICT MODE: 透過標題比對
        if (publisherName.length > 1) {
          matchedChunk = candidateChunks.find(c => c.title.includes(publisherName) && !usedUris.has(c.uri))
                      || candidateChunks.find(c => c.title.includes(publisherName))
                      || availableChunks.find(c => c.title.includes(publisherName) && !usedUris.has(c.uri))
                      || availableChunks.find(c => c.title.includes(publisherName));
        }
        // 只有在沒有預期網域且標題比對失敗時，才謹慎使用 AI 提供的網域
        if (!matchedChunk && aiDomain) {
          matchedChunk = candidateChunks.find(c => c.domain.includes(aiDomain) && !usedUris.has(c.uri))
                      || candidateChunks.find(c => c.domain.includes(aiDomain))
                      || availableChunks.find(c => c.domain.includes(aiDomain) && !usedUris.has(c.uri))
                      || availableChunks.find(c => c.domain.includes(aiDomain));
        }
      }
    }

    if (matchedChunk) {
      const matchedUri = matchedChunk.uri;
      usedUris.add(matchedUri);
      if (!verifiedSources.find(s => s.uri === matchedUri)) {
        verifiedSources.push({ title: matchedChunk.title, uri: matchedUri });
      }
      return `${prefix}[${actualLinkText}](${matchedUri})`;
    } else {
      return `${prefix}${actualLinkText} (來源未驗證)`;
    }
  });

  return { text: processedText, sources: verifiedSources, usedUris };
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
3. 標註連結：在引用後方提供完整的「日期＋媒體名稱」的超連結。請確保連結為當下可點擊且直接連往該關鍵論點頁面的網址。
4. 最終校核：在輸出前，請再次檢查該連結是否存在於你的檢索結果中。絕對禁止虛妄連結：超連結網址必須是「真實存在」且「直接連到該篇新聞」的絕對網址。你必須從 Google Search 的結果 (Grounding Sources) 中精確複製該新聞的真實 URL。如果找不到直接連結，請直接註明【資料不足，無法確認】，嚴禁拼湊網址。

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
3. 標註連結：在引用後方提供完整的「日期＋媒體名稱」的超連結。請確保連結為當下可點擊且直接連往該關鍵論點頁面的網址。
4. 最終校核：在輸出前，請再次檢查該連結是否存在於你的檢索結果中。絕對禁止虛妄連結：超連結網址必須是「真實存在」且「直接連到該篇新聞」的絕對網址。你必須從 Google Search 的結果 (Grounding Sources) 中精確複製該新聞的真實 URL。如果找不到直接連結，請直接註明【資料不足，無法確認】，嚴禁拼湊網址。

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
    const { text: finalProcessedText, sources: verifiedSources } = processMarkdownLinks(text, response.candidates[0].groundingMetadata);

    const result = {
      text: finalProcessedText,
      sources: verifiedSources.length > 0 ? verifiedSources : uniqueSources,
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
1. 軍事動態 (Military) - 權重 60%
2. 經濟封鎖 (Economic) - 權重 20%
3. 外交打壓 (Diplomatic) - 權重 10%
4. 認知作戰 (Cognitive) - 權重 10%

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
5. 來源連結強制要求：請在 description 欄位中，針對關鍵論點加上超連結。格式：...「引用不超過10字」 [2026-03-14 中央社](https://www.cna.com.tw/...)。
6. 唯一性要求：每一條引用必須對應其「專屬」的原始網頁連結。嚴禁多個不同來源指向同一個網址。

JSON 格式範例：
[
  {
    "date": "2026-03-08",
    "title": "國防部偵獲多架次共機越過海峽中線",
    "description": "國防部今日表示，自上午起陸續偵獲多架次共機出海活動，其中部分逾越海峽中線及其延伸線... [2026-03-08 國防部](https://www.mnd.gov.tw/...)",
    "category": "military",
    "impactLevel": 8
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
    let eventsArray = Array.isArray(parsedData) ? parsedData : (parsedData.events || []);
    
    const usedUris = new Set<string>();
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

    eventsArray = eventsArray.map((event: TimelineEvent) => {
      // Clean up markdown links in title if AI generated them
      if (event.title) {
        const mdLinkMatch = event.title.match(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
        if (mdLinkMatch) {
          event.title = mdLinkMatch[1];
        }
      }
      
      // Process markdown links in description
      if (event.description && groundingMetadata) {
        const { text: processedDesc } = processMarkdownLinks(event.description, groundingMetadata, usedUris);
        event.description = processedDesc;
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
請扮演頂尖的開源情報（OSINT）分析師。你的任務是搜尋「國防部 臺海周邊海、空域動態」的「當日（當地時間 ${todayStr} 00:00 至 23:59）、即時」最新發布資料，以及中國海事局最新的「航行警告 / 禁航區 / 演習」公告。

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
