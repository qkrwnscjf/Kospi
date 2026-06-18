import { fetchYahooData } from './yahoo-api.js';
import { fetchNaverData } from './naver-api.js';
import { producer } from '../kafka.js';

const POLLING_INTERVAL_MS = 10000; // 10 seconds

async function runIngestionWorker() {
  console.log('🚀 Data Ingestion Worker Started...');
  console.log(`Polling interval: ${POLLING_INTERVAL_MS}ms`);

  await producer.connect();
  console.log('Connected to Kafka producer.');

  setInterval(async () => {
    try {
      console.log(`\n[${new Date().toISOString()}] Fetching market data...`);
      
      const [yahooData, naverData] = await Promise.all([
        fetchYahooData(),
        fetchNaverData()
      ]);

      const allData = [...yahooData, ...naverData];

      if (allData.length > 0) {
        console.log(`Successfully fetched ${allData.length} items. Sending to Kafka...`);
        
        const messages = allData.map(data => {
          // Map ticker to symbol for internal TickData usage
          const tickData = {
            symbol: data.ticker,
            category: data.category,
            price: data.price,
            changeRate: data.changeRate,
            changePrice: data.changePrice,
            timestamp: data.timestamp,
            volume: data.volume
          };

          return {
            key: data.ticker,
            value: JSON.stringify(tickData)
          };
        });

        await producer.send({ topic: 'market-ticks', messages });

        // 콘솔 출력 테스트 (상위 3개만)
        console.log('Sample Data Sent:', allData.slice(0, 3).map(d => d.ticker));
      }
    } catch (error) {
      console.error('Worker loop error:', error);
    }
  }, POLLING_INTERVAL_MS);
}

runIngestionWorker().catch(console.error);
