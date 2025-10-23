const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const path = require('path');
const { getHeaders } = require('./utils/headers');

// Load JWT token and filtered symbols with defensive checks
let jwtToken = null;
let filteredSymbols = [];
try {
  const jwtPath = path.join(__dirname, 'data', 'jwtToken.json');
  if (fs.existsSync(jwtPath)) {
    const jwtRaw = fs.readFileSync(jwtPath, 'utf8');
    const jwtObj = JSON.parse(jwtRaw || '{}');
    jwtToken = jwtObj.jwtToken || null;
  } else {
    console.warn('Warning: data/jwtToken.json not found. Run the connect trigger to generate it.');
  }
} catch (e) {
  console.warn('Warning: error loading data/jwtToken.json:', e.message || e);
}

try {
  const filteredPath = path.join(__dirname, 'data', 'filtered_candles_strict.json');
  if (fs.existsSync(filteredPath)) {
    const raw = fs.readFileSync(filteredPath, 'utf8');
    filteredSymbols = JSON.parse(raw || '[]');
  } else {
    console.warn('Warning: data/filtered_candles_strict.json not found. Price filter should be run first.');
  }
} catch (e) {
  console.warn('Warning: error loading filtered symbols:', e.message || e);
  filteredSymbols = [];
}

// SmartAPI endpoint
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

// Get timestamps for 1 year back
function getTimestamps() {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  return { fromDate: formatDate(fromDate), toDate: formatDate(toDate) };
}

// Fetch candle data for a single symbol
async function fetchCandleData(symbolObj, interval = 'ONE_HOUR') {
  try {
    const { fromDate, toDate } = getTimestamps();

    if (!jwtToken) throw new Error('Missing jwtToken - please run connect/login first');

    const config = await getConfig();
    config.data = JSON.stringify({
      exchange: symbolObj.exchange || 'NSE',
      symboltoken: symbolObj.token,
      interval: interval,
      fromdate: fromDate,
      todate: toDate
    });

    const response = await axios(config);
    return {
      symbol: symbolObj.symbol,
      token: symbolObj.token,
      exchange: symbolObj.exchange,
      candles: response.data
    };
  } catch (error) {
    console.error(`Error fetching ${symbolObj.symbol}:`, error.message || error);
    return null;
  }
}

// Fetch all 1-hour candles and save to one JSON file
async function fetchAllCandles() {
  // If filteredSymbols is empty, try to fall back to nseEquitySymbols.json
  if (!filteredSymbols || filteredSymbols.length === 0) {
    console.warn('filteredSymbols list is empty. Attempting fallback to data/nseEquitySymbols.json');
    try {
      const nsePath = path.join(__dirname, 'data', 'nseEquitySymbols.json');
      if (fs.existsSync(nsePath)) {
        const raw = fs.readFileSync(nsePath, 'utf8');
        const nseList = JSON.parse(raw || '[]');
        if (nseList && nseList.length > 0) {
          filteredSymbols = nseList;
          console.log(`Fallback loaded ${filteredSymbols.length} symbols from nseEquitySymbols.json`);
        } else {
          console.warn('Fallback file exists but contains no symbols. Aborting one-hour fetch.');
          return { success: false, message: 'No symbols to fetch (filtered and fallback empty).' };
        }
      } else {
        console.warn('Fallback file data/nseEquitySymbols.json not found. Aborting one-hour fetch.');
        return { success: false, message: 'No symbols to fetch (filtered empty and no fallback file).' };
      }
    } catch (e) {
      console.error('Error loading fallback symbols:', e.message || e);
      return { success: false, message: 'Failed to load fallback symbols.' };
    }
  }

  // Respect an optional limit to avoid very large runs
  const limit = parseInt(process.env.ONEHOUR_SYMBOL_LIMIT || '200', 10);
  const symbolsToProcess = filteredSymbols.slice(0, limit);

  console.log(`Starting to fetch 1-hour candles for ${symbolsToProcess.length} symbols... (limit ${limit})`);
  const RATE_LIMIT_MS = parseInt(process.env.ONEHOUR_RATE_LIMIT_MS || '500', 10);
  const allCandles = [];

  for (let i = 0; i < symbolsToProcess.length; i++) {
    const symbolObj = symbolsToProcess[i];
    const candleData = await fetchCandleData(symbolObj, 'ONE_HOUR');
    if (candleData) allCandles.push(candleData);

    console.log(`Fetched ${i + 1} / ${symbolsToProcess.length} symbols (${symbolObj.symbol})`);

    // Respect rate limit
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  }

  const outputFile = path.join(__dirname, 'data/all_candles_1hr.json');
  fs.writeFileSync(outputFile, JSON.stringify(allCandles, null, 2));
  console.log(`All 1-hour candle data saved to ${outputFile}`);
}

module.exports = {
    fetchOneHourData: fetchAllCandles
};
