const fs = require('fs');
const path = require('path');

// === Paths ===
const inputFile = path.join(__dirname, 'data/all_candles.json');
const outputFile = path.join(__dirname, 'data/filtered_candles_strict.json');

// === Core Filters ===
// Keep price filter (unchanged)
const MIN_PRICE = 50;
const MAX_PRICE = 500;

// === Latest Filters (2025 common algo practice) ===
const TURNOVER_PERIOD = 20;             // last N candles to compute average turnover
const MIN_AVG_TURNOVER = 5_00_000;      // ₹5L per candle average value traded
const RELATIVE_STRENGTH_PERIOD = 20;    // lookback for price change (%)
const MIN_RELATIVE_STRENGTH = 0.03;     // +3% over last 20 candles (momentum)

function runFilter() {
  // Load all candle data
  let allCandles;
  try {
    allCandles = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  } catch (error) {
    console.error('Error reading all_candles.json:', error);
    return;
  }

  // === Helper: Compute Average Turnover (close * volume) ===
  function avgTurnover(candles, period) {
    const slice = candles.slice(-period);
    if (slice.length === 0) return 0;
    const total = slice.reduce((sum, c) => sum + (c.close * c.volume), 0);
    return total / slice.length;
  }

  // === Helper: Compute Relative Strength (price % change over N candles) ===
  function relativeStrength(candles, period) {
    if (candles.length < period) return 0;
    const start = candles[candles.length - period].close;
    const end = candles[candles.length - 1].close;
    return (end - start) / start; // percentage change (e.g., 0.05 = +5%)
  }

  // === Helper: Validate a symbol ===
  function passesFilters(candles) {
    if (!candles || candles.length < RELATIVE_STRENGTH_PERIOD) return false;

    const last = candles[candles.length - 1];
    if (last.close < MIN_PRICE || last.close > MAX_PRICE) return false;

    const avgT = avgTurnover(candles, TURNOVER_PERIOD);
    const rs = relativeStrength(candles, RELATIVE_STRENGTH_PERIOD);

    return avgT >= MIN_AVG_TURNOVER && rs >= MIN_RELATIVE_STRENGTH;
  }

  // === Filtering ===
  const filteredCandles = allCandles.map(symbolData => {
    if (!symbolData.candles || !Array.isArray(symbolData.candles.data)) {
      console.warn(`Skipping ${symbolData.symbol}: candles.data is not an array`);
      return null;
    }

    const candleObjects = symbolData.candles.data.map(c => ({
      datetime: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));

    // Apply new filter
    if (!passesFilters(candleObjects)) return null;

    return {
      symbol: symbolData.symbol,
      token: symbolData.token,
      exchange: symbolData.exchange,
      candles: candleObjects
    };
  }).filter(Boolean);

  // === Output ===
  fs.writeFileSync(outputFile, JSON.stringify(filteredCandles, null, 2));
  console.log(`Filtered candle data (strict, latest method) saved to ${outputFile}`);
  console.log(`Total symbols with filtered candles: ${filteredCandles.length}`);
}

module.exports = {
  filterPrices: runFilter
};