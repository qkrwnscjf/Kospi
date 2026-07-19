import axios from 'axios';
import type { NormalizedMarketData } from './normalizer.js';

// Naver Finance Polling API (Undocumented, use with caution for production)
const NAVER_POLLING_URL = 'https://polling.finance.naver.com/api/realtime';

const NAVER_INDICES = {
  // Sector and Specific indices
  VKOSPI: 'SERVICE_INDEX:VKOSPI',
  KRX_SEMI: 'SERVICE_INDEX:WMI510',     // 반도체
  KRX_IT: 'SERVICE_INDEX:WMI500',       // IT
  KRX_AUTO: 'SERVICE_INDEX:WMI330',     // 자동차
  KRX_BANK: 'SERVICE_INDEX:WMI540',     // 은행
  KRX_BIO: 'SERVICE_INDEX:WMI340',      // 제약/바이오
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
