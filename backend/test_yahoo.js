import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
yahooFinance.chart('^KS11', { period1: '2023-01-01', interval: '1d' }).then(res => console.log('Length:', res.quotes.length, 'Sample:', res.quotes[0])).catch(console.error);
//# sourceMappingURL=test_yahoo.js.map