import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface TickData {
  symbol: string;
  category: string;
  price: number;
  changeRate: number;
  changePrice?: number;
  timestamp: number;
  volume?: number;
}

const SOCKET_URL = 'http://localhost:3001';
const API_URL = 'http://localhost:3001/api/v1/market/history';

export function useMarketData(symbol: string, initialData: any[], timeframe: string) {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [chartData, setChartData] = useState<any[]>(initialData);

  useEffect(() => {
    if (!symbol) return;

    if (timeframe !== '실시간') {
      // Fetch historical data from REST API
      let isMounted = true;
      fetch(`${API_URL}?ticker=${symbol}&timeframe=${timeframe}`)
        .then(res => res.json())
        .then(data => {
          if (isMounted) {
            setChartData(data.data);
          }
        })
        .catch(err => console.error('Failed to fetch history', err));
      
      return () => { isMounted = false; };
    }

    // Real-time WebSocket stream (only when timeframe is '실시간')
    const socket: Socket = io(SOCKET_URL);

    socket.on('connect', () => {
      console.log(`Connected to market stream: ${symbol}`);
      socket.emit('subscribe_market', symbol);
    });

    socket.on('tick', (tick: TickData) => {
      if (tick.symbol === symbol) {
        setCurrentPrice(tick.price);
        setPriceChange(tick.changeRate);

        // Update chart data
        setChartData((prev) => {
          const newData = [...prev, { time: tick.timestamp, value: tick.price }];
          if (newData.length > 50) {
            newData.shift(); // Keep last 50 points
          }
          return newData;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [symbol, timeframe]);

  return {
    currentPrice,
    priceChange,
    chartData,
  };
}
