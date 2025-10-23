const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const { getHeaders } = require('./utils/headers');

// Load JWT token and NSE symbols with defensive checks
let jwtToken = null;
let nseSymbols = [];
try {
  const jwtPath = require('path').join(__dirname, 'data', 'jwtToken.json');
  if (fs.existsSync(jwtPath)) {
    const jwtRaw = fs.readFileSync(jwtPath, 'utf8');
    const jwtObj = JSON.parse(jwtRaw || '{}');
    jwtToken = jwtObj.jwtToken || null;
  } else {
    console.warn('Warning: data/jwtToken.json not found. Some API calls may fail until login runs.');
  }
} catch (e) {
  console.warn('Warning: error loading data/jwtToken.json:', e.message || e);
}

try {
  const nsePath = require('path').join(__dirname, 'data', 'nseEquitySymbols.json');
  if (fs.existsSync(nsePath)) {
    const nseRaw = fs.readFileSync(nsePath, 'utf8');
    nseSymbols = JSON.parse(nseRaw || '[]');
  } else {
    console.warn('Warning: data/nseEquitySymbols.json not found. Run the connect trigger to generate it.');
  }
} catch (e) {
  console.warn('Warning: error loading data/nseEquitySymbols.json:', e.message || e);
  nseSymbols = [];
}

// SmartAPI Candlestick endpoint config
const getConfig = async () => ({
  method: 'post',
  url: 'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
  headers: await getHeaders({
    'Authorization': `Bearer ${jwtToken}`
  }),
  data: {}
});

// Helper to format date as 'YYYY-MM-DD HH:mm'
function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// Helper to get timestamps
function getTimestamps() {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 1); // 1 year back
  return { fromDate: formatDate(fromDate), toDate: formatDate(toDate) };
}

// Fetch candle data for a single symbol
async function fetchCandleData(symbolObj, interval = 'ONE_HOUR') {
  try {
    const { fromDate, toDate } = getTimestamps();

    if (!jwtToken) {
      throw new Error('Missing jwtToken - please run the login/connect flow first');
    }

    const config = await getConfig();
    config.data = JSON.stringify({
      exchange: 'NSE',
      symboltoken: symbolObj.token,
      interval: interval,
      fromdate: fromDate,
      todate: toDate
    });

    const response = await axios(config);

    return {
      symbol: symbolObj.symbol,
      token: symbolObj.token,
      exchange: symbolObj.exch,
      candles: response.data
    };

  } catch (error) {
    console.error(`Error fetching candles for ${symbolObj.symbol}:`, error.message || error);
    return null;
  }
}

// Fetch all candles and save to single JSON
async function fetchAllCandles() {
  console.log(`Starting to fetch candles for ${nseSymbols.length} symbols...`);
  const RATE_LIMIT_MS = 500;
  const allCandles = [];

  for (let i = 0; i < nseSymbols.length; i++) {
    const candleData = await fetchCandleData(nseSymbols[i], 'ONE_HOUR');
    if (candleData) allCandles.push(candleData);

    console.log(`Fetched ${i + 1} / ${nseSymbols.length} symbols (${nseSymbols[i].symbol})`);
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  }

  fs.writeFileSync('data/all_candles.json', JSON.stringify(allCandles, null, 2));
  console.log('All candle data saved to data/all_candles.json');
}

module.exports = {
    fetchCandles: fetchAllCandles
};
