import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
yahooFinance.quote(['^KS11']).then(res => console.log(res)).catch(console.error);
//# sourceMappingURL=test_quote.js.map