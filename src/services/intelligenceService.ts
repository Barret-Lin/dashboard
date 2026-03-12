import { GoogleGenAI, Type } from '@google/genai';

const DEFAULT_FALLBACK_KEYS = [
  "AIzaSyDTF2hcOOXHR2vLGlgmWmQBc9BMe9p3bSY",
  "AIzaSyAC1pRRkWxoVant1Yn1yyfg5qaX8OQZ5x8",
  "AIzaSyAgh2fSZsyATHZg5mkikAB5d3ZsNaeibo8",
  "AIzaSyDNnMnress1mTo4Vk2cLHdIGB7Ja2GQNGI",
  "AIzaSyBdilcrOcfZCfJb0-eji_RYZfS9xveMuKA"
];

export function getFallbackKeys(): string[] {
  try {
    const stored = localStorage.getItem('AIS_FALLBACK_KEYS');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse stored keys', e);
  }
  return [...DEFAULT_FALLBACK_KEYS];
}

export function saveFallbackKeys(keys: string[]) {
  localStorage.setItem('AIS_FALLBACK_KEYS', JSON.stringify(keys));
}

let currentKeyIndex = 0;

export const keyUsageStats: Record<string, { success: number; errors: number; lastUsed?: Date; requestsToday: number; lastResetDate: string; rateLimitedUntil?: Date }> = {};

const requestTimestamps: Record<string, number[]> = {};

export function recordApiRequest(key: string) {
  if (!requestTimestamps[key]) {
    requestTimestamps[key] = [];
  }
  requestTimestamps[key].push(Date.now());
}

export function getRpmCount(key?: string): number {
  const now = Date.now();
  if (key) {
    if (!requestTimestamps[key]) return 0;
    while (requestTimestamps[key].length > 0 && now - requestTimestamps[key][0] > 60000) {
      requestTimestamps[key].shift();
    }
    return requestTimestamps[key].length;
  }
  
  let total = 0;
  for (const k in requestTimestamps) {
    if (k === 'undefined') continue;
    while (requestTimestamps[k].length > 0 && now - requestTimestamps[k][0] > 60000) {
      requestTimestamps[k].shift();
    }
    total += requestTimestamps[k].length;
  }
  return total;
}

let apiLock = Promise.resolve();

async function executeWithLock<T>(fn: () => Promise<T>): Promise<T> {
  let releaseLock: () => void;
  const nextLock = new Promise<void>(resolve => {
    releaseLock = resolve;
  });
  
  const currentLock = apiLock;
  apiLock = currentLock.then(() => nextLock);
  
  await currentLock;
  try {
    return await fn();
  } finally {
    // Add a 500ms delay between requests to prevent concurrency/burst rate limits
    setTimeout(releaseLock, 500);
  }
}

function getPTDateString() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
}

function initStats(key: string) {
  const today = getPTDateString();
  if (!keyUsageStats[key]) {
    keyUsageStats[key] = { success: 0, errors: 0, requestsToday: 0, lastResetDate: today };
  } else if (keyUsageStats[key].lastResetDate !== today) {
    keyUsageStats[key].requestsToday = 0;
    keyUsageStats[key].lastResetDate = today;
  }
}

function getAiClient(customKey?: string) {
  if (customKey) {
    initStats(customKey);
    return { client: new GoogleGenAI({ apiKey: customKey }), key: customKey };
  }
  const fallbackKeys = getFallbackKeys();
  const allKeys = [process.env.GEMINI_API_KEY, ...fallbackKeys].filter(Boolean) as string[];
  
  let selectedKey = allKeys[0];
  let foundKey = false;
  
  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[(currentKeyIndex + i) % allKeys.length];
    initStats(key);
    const rpm = getRpmCount(key);
    const rpd = keyUsageStats[key].requestsToday;
    const isRateLimited = keyUsageStats[key].rateLimitedUntil && keyUsageStats[key].rateLimitedUntil! > new Date();
    
    // Proactively switch key if it's near limits (14 RPM or 1450 RPD) or currently rate limited
    if (rpm < 14 && rpd < 1450 && !isRateLimited) {
      selectedKey = key;
      currentKeyIndex = (currentKeyIndex + i) % allKeys.length;
      foundKey = true;
      break;
    }
  }
  
  // If all keys are exhausted/rate-limited, just return the current one and let it fail
  if (!foundKey) {
    selectedKey = allKeys[currentKeyIndex % allKeys.length];
    currentKeyIndex = (currentKeyIndex + 1) % allKeys.length;
  }
  
  initStats(selectedKey);
  return { client: new GoogleGenAI({ apiKey: selectedKey }), key: selectedKey };
}

export interface KeyStatus {
  key: string;
  status: 'VALID' | 'RATE_LIMITED' | 'INVALID' | 'UNKNOWN';
  isCustom?: boolean;
  usage: { success: number; errors: number; lastUsed?: Date; requestsToday: number; lastResetDate: string };
}

export async function checkApiKeyStatus(apiKey: string): Promise<KeyStatus['status']> {
  initStats(apiKey);
  try {
    const ai = new GoogleGenAI({ apiKey });
    recordApiRequest(apiKey);
    await executeWithLock(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'hi',
      config: { maxOutputTokens: 1 }
    }));
    keyUsageStats[apiKey].requestsToday++;
    return 'VALID';
  } catch (error: any) {
    keyUsageStats[apiKey].requestsToday++;
    if (error?.message?.includes('API key not valid') || error?.message?.includes('API_KEY_INVALID') || error?.status === 400 || error?.status === 403) {
      return 'INVALID';
    }
    if (error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('quota') || error?.message?.includes('Resource has been exhausted')) {
      if (error?.message?.includes('quota') || error?.message?.includes('Resource has been exhausted')) {
        keyUsageStats[apiKey].requestsToday = 1500; // Mark as exhausted for the day
      } else {
        keyUsageStats[apiKey].rateLimitedUntil = new Date(Date.now() + 60000); // 1 minute cooldown for 429
      }
      return 'RATE_LIMITED';
    }
    return 'UNKNOWN';
  }
}

export async function getAllKeysStatus(): Promise<KeyStatus[]> {
  const fallbackKeys = getFallbackKeys();
  const allKeys = [process.env.GEMINI_API_KEY, ...fallbackKeys].filter(Boolean) as string[];
  const promises = allKeys.map(async (key) => {
    const status = await checkApiKeyStatus(key);
    initStats(key);
    return { key, status, isCustom: false, usage: keyUsageStats[key] };
  });
  return Promise.all(promises);
}

export interface IntelligenceData {
  text: string;
  sources: { title: string; uri: string }[];
  isRateLimited?: boolean;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getLocalCache(key: string) {
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL) {
        return parsed.data;
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
  const cacheKey = `intel_${categoryId}_${customApiKey || 'default'}`;
  
  if (!forceRefresh) {
    const cachedData = getLocalCache(cacheKey);
    if (cachedData) {
      return cachedData as IntelligenceData;
    }
  }

  let prompt = '';
  if (categoryId === 'weekly_threat') {
    prompt = `請搜尋今日（最近 24 小時內），關於中國對台灣的最新動態與新聞。
請特別包含「國外主流媒體（如 CNN, BBC, Reuters, Bloomberg 等）」以及「社群網路（如 X/Twitter, Telegram, Reddit 等）」上的相關討論與情報。
請以專業的軍事與地緣政治情報分析師的角度，撰寫一份即時戰情摘要（繁體中文）。
請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：請分析並列出最近 24 小時與台海相關的重大「軍事」、「經濟」、「外交」或「認知作戰」的事件，並提供具體時間點與消息來源（標註是外媒、社群或官方，並務必附上直接的 Markdown 網址連結，例如：[CNN 報導](https://...)）。
2. **威脅評估**：分析這些行動對台灣的整體影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  } else {
    prompt = `請搜尋今日（最近 24 小時內），關於中國對台灣的「${categoryQuery}」最新動態與新聞。
請特別包含「國外主流媒體（如 CNN, BBC, Reuters, Bloomberg 等）」以及「社群網路（如 X/Twitter, Telegram, Reddit 等）」上的相關討論與情報。
請以專業的軍事與地緣政治情報分析師的角度，撰寫一份即時戰情摘要（繁體中文）。
請使用 Markdown 格式排版，包含以下內容：
1. **近期重大事件**：列出具體事件、時間點與消息來源（標註是外媒、社群或官方，並務必附上直接的 Markdown 網址連結，例如：[CNN 報導](https://...)）。
2. **威脅評估**：分析這些行動對台灣的影響與威脅程度。
3. **戰略意圖分析**：簡述背後可能的戰略或政治目的。

請確保資訊是最新的，並基於真實的新聞報導與社群動態。`;
  }

  const maxRetries = customApiKey ? 1 : getFallbackKeys().length + 1;
  let lastError: any = null;

  for (let i = 0; i < maxRetries; i++) {
    const { client: ai, key } = getAiClient(customApiKey);
    try {
      recordApiRequest(key);
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

      keyUsageStats[key].success++;
      keyUsageStats[key].requestsToday++;
      keyUsageStats[key].lastUsed = new Date();

      const result = {
        text,
        sources: uniqueSources,
      };
      setLocalCache(cacheKey, result);
      return result;
    } catch (error: any) {
      keyUsageStats[key].errors++;
      keyUsageStats[key].requestsToday++;
      keyUsageStats[key].lastUsed = new Date();
      lastError = error;

      const isRateLimited = error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('quota') || error?.message?.includes('Resource has been exhausted');
      
      if (isRateLimited) {
        if (error?.message?.includes('quota') || error?.message?.includes('Resource has been exhausted')) {
          keyUsageStats[key].requestsToday = 1500; // Mark as exhausted for the day
        } else {
          keyUsageStats[key].rateLimitedUntil = new Date(Date.now() + 60000); // 1 minute cooldown
        }
      }
      
      if (isRateLimited && !customApiKey && i < maxRetries - 1) {
        // Try the next key
        continue;
      }
      
      if (!isRateLimited) {
        console.error("Error fetching intelligence:", error);
      }
      break; // Break on non-rate-limit error or if we've exhausted retries
    }
  }

  let errorMessage = "無法取得即時情報，請稍後再試。可能是因為 API 限制或網路問題。";
  if (lastError?.message?.includes('429') || lastError?.status === 429 || lastError?.message?.includes('quota') || lastError?.message?.includes('Resource has been exhausted')) {
    const isSearchQuota = lastError?.message?.includes('quota') || lastError?.message?.includes('Resource has been exhausted');
    const reasonText = isSearchQuota ? "（包含每日總額度或 Google 搜尋工具配額已耗盡）" : "（免費版 API 有嚴格的每分鐘頻率限制）";
    
    return {
      text: customApiKey 
        ? `⚠️ **您的 API 金鑰請求次數已達上限 (Quota Exceeded)**\n\n您輸入的 API 金鑰已超出配額限制${reasonText}。請注意，Google 的頻率限制是跨網頁與應用程式計算的，請稍後再試，或更換其他金鑰。\n\n**原始錯誤訊息：**\n\`${lastError?.message || 'Unknown Error'}\``
        : `⚠️ **API 請求次數已達上限 (Quota Exceeded)**\n\n內建的 API 金鑰已超出配額限制${reasonText}。請在下方輸入您自己的 API 金鑰以繼續使用。\n\n**原始錯誤訊息：**\n\`${lastError?.message || 'Unknown Error'}\``,
      sources: [],
      isRateLimited: !customApiKey
    };
  }

  return {
    text: errorMessage,
    sources: [],
  };
}

export interface ThreatLevelData {
  level: string;
  summary: string;
  totalScore?: number;
  scores?: { military: number; economic: number; diplomatic: number; cognitive: number };
  explanation?: string;
  sources?: { title: string; uri: string }[];
  isRateLimited?: boolean;
}

export async function fetchOverallThreatLevel(customApiKey?: string, forceRefresh = false): Promise<ThreatLevelData> {
  const cacheKey = `threat_${customApiKey || 'default'}`;
  
  if (!forceRefresh) {
    const cachedData = getLocalCache(cacheKey);
    if (cachedData) {
      return cachedData as ThreatLevelData;
    }
  }

  const prompt = `請搜尋今日關於台海局勢的新聞（包含國內外媒體及社群網路），評估目前的整體威脅等級。
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

請嚴格回傳 JSON 格式，不要包含 Markdown 語法或額外文字。`;

  const maxRetries = customApiKey ? 1 : getFallbackKeys().length + 1;
  let lastError: any = null;

  for (let i = 0; i < maxRetries; i++) {
    const { client: ai, key } = getAiClient(customApiKey);
    try {
      recordApiRequest(key);
      const response = await executeWithLock(() => ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              level: {
                type: Type.STRING,
                description: "威脅等級，必須是以下之一：'CRITICAL', 'HIGH', 'ELEVATED', 'GUARDED', 'LOW'",
              },
              summary: {
                type: Type.STRING,
                description: "一句話總結目前局勢（繁體中文）",
              },
              totalScore: {
                type: Type.NUMBER,
                description: "加權計算後的總分 (0-100)",
              },
              scores: {
                type: Type.OBJECT,
                properties: {
                  military: { type: Type.NUMBER, description: "軍事動態評分 (0-100)" },
                  economic: { type: Type.NUMBER, description: "經濟封鎖評分 (0-100)" },
                  diplomatic: { type: Type.NUMBER, description: "外交打壓評分 (0-100)" },
                  cognitive: { type: Type.NUMBER, description: "認知作戰評分 (0-100)" }
                },
                required: ["military", "economic", "diplomatic", "cognitive"]
              },
              explanation: {
                type: Type.STRING,
                description: "等級判別說明與各面向評分理由（繁體中文）",
              }
            },
            required: ["level", "summary", "totalScore", "scores", "explanation"]
          }
        },
      }));

      const data = JSON.parse(response.text || '{}');
      
      // Extract sources
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = groundingChunks
        .map((chunk: any) => ({
          title: chunk.web?.title || '未知來源',
          uri: chunk.web?.uri || '',
        }))
        .filter((s: any) => s.uri);
      
      const uniqueSources = Array.from(new Map(sources.map((s: any) => [s.uri, s])).values()) as { title: string; uri: string }[];
      data.sources = uniqueSources;
      
      keyUsageStats[key].success++;
      keyUsageStats[key].requestsToday++;
      keyUsageStats[key].lastUsed = new Date();
      
      setLocalCache(cacheKey, data);
      return data;
    } catch (e: any) {
      keyUsageStats[key].errors++;
      keyUsageStats[key].requestsToday++;
      keyUsageStats[key].lastUsed = new Date();
      lastError = e;

      const isRateLimited = e?.message?.includes('429') || e?.status === 429 || e?.message?.includes('quota') || e?.message?.includes('Resource has been exhausted');
      
      if (isRateLimited) {
        if (e?.message?.includes('quota') || e?.message?.includes('Resource has been exhausted')) {
          keyUsageStats[key].requestsToday = 1500; // Mark as exhausted for the day
        } else {
          keyUsageStats[key].rateLimitedUntil = new Date(Date.now() + 60000); // 1 minute cooldown
        }
      }
      
      if (isRateLimited && !customApiKey && i < maxRetries - 1) {
        // Try the next key
        continue;
      }

      if (!isRateLimited) {
        console.error("Error fetching threat level:", e);
      }
      break;
    }
  }

  if (lastError?.message?.includes('429') || lastError?.status === 429 || lastError?.message?.includes('quota') || lastError?.message?.includes('Resource has been exhausted')) {
    const isSearchQuota = lastError?.message?.includes('quota') || lastError?.message?.includes('Resource has been exhausted');
    const reasonText = isSearchQuota ? "（每日總額度或 Google 搜尋工具配額已耗盡）" : "（每分鐘頻率限制）";
    
    return { 
      level: 'UNKNOWN', 
      summary: customApiKey ? `您的 API 金鑰已達請求上限${reasonText}。請稍後再試。` : `API 請求次數已達上限${reasonText}，請輸入自訂 API Key。`, 
      isRateLimited: !customApiKey 
    };
  }

  return { level: 'ELEVATED', summary: '無法取得即時威脅等級，請保持警戒。' };
}
