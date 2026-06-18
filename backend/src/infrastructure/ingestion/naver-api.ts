import axios from 'axios';
import type { NormalizedMarketData } from './normalizer.js';

// Naver Finance Polling API (Undocumented, use with caution for production)
const NAVER_POLLING_URL = 'https://polling.finance.naver.com/api/realtime';

const NAVER_INDICES = {
  // Sector and Specific indices
  VKOSPI: 'SERVICE_INDEX:VKOSPI',
  // Note: For KRX Sectors (e.g., KRX 반도체, KRX 자동차), you need to find the specific 
  // Naver index code (e.g., SERVICE_INDEX:KRX100 or similar)
  KRX_SEMI: 'SERVICE_INDEX:WMI510', // Placeholder example code
};

type NaverSymbolKey = keyof typeof NAVER_INDICES;

export async function fetchNaverData(): Promise<NormalizedMarketData[]> {
  try {
    const keys = Object.keys(NAVER_INDICES) as NaverSymbolKey[];
    const queryParams = keys.map(k => NAVER_INDICES[k]).join(',');
    
    // Request format: ?query=SERVICE_INDEX:VKOSPI,SERVICE_INDEX:WMI510
    const response = await axios.get(NAVER_POLLING_URL, {
      params: { query: queryParams }
    });

    const dataList = response.data?.result?.areas?.[0]?.datas || [];
    
    return dataList.map((item: any) => {
      // item.cd is the code (e.g. "VKOSPI")
      const key = keys.find(k => NAVER_INDICES[k].includes(item.cd)) || item.cd;
      
      return {
        ticker: key,
        category: 'sector', // VKOSPI and Sectors
        price: parseFloat(item.nv) || 0,
        changeRate: parseFloat(item.cr) || 0,
        changePrice: parseFloat(item.cv) || 0,
        timestamp: Date.now(),
      };
    });
  } catch (error) {
    console.error('Error fetching Naver Finance data:', error);
    return [];
  }
}
