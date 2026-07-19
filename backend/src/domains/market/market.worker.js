import { producer } from '../../infrastructure/kafka.js';
const SYMBOLS = ['KOSPI', 'KOSDAQ', 'USD_KRW', 'SP500'];
let basePrices = {
    'KOSPI': 2600,
    'KOSDAQ': 850,
    'USD_KRW': 1370,
    'SP500': 5200,
};
export const startIngestionWorker = async () => {
    try {
        await producer.connect();
        console.log('Ingestion Worker connected to Kafka');
        setInterval(async () => {
            for (const symbol of SYMBOLS) {
                // Simulate random price change (-2.5 to +2.5)
                const change = (Math.random() - 0.5) * 5;
                basePrices[symbol] += change;
                const tick = {
                    symbol,
                    price: parseFloat(basePrices[symbol].toFixed(2)),
                    change: parseFloat(change.toFixed(2)),
                    timestamp: Date.now()
                };
                await producer.send({
                    topic: 'market-ticks',
                    messages: [{ key: symbol, value: JSON.stringify(tick) }],
                });
            }
        }, 1000); // 1 second intervals
    }
    catch (err) {
        console.error('Failed to start ingestion worker', err);
    }
};
//# sourceMappingURL=market.worker.js.map