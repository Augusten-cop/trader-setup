const fs = require("fs");
const path = require("path");

// === Constants (tweakable) ===
const ATR_PERIOD = 14;              // used for general ATR where needed
const SR_LOOKBACK = 30;
const COMMISSION_PER_TRADE = 0.0005; // 0.05%
const SLIPPAGE_PCT = 0.0007;         // 0.07%
const ACCOUNT_SIZE = 100000;         // Rupees
const RISK_PER_TRADE_PCT = 0.005;    // 0.5% risk per trade

// Supertrend-specific params (widely used defaults: ATR 10-14, multiplier 3)
const SUPER_ATR_PERIOD = 10;
const SUPER_MULTIPLIER = 3;

// === Helper Functions ===

function calculateSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((sum, val) => sum + val, 0) / period;
    sma.push(avg);
  }
  return sma;
}

function calculateTRArray(df) {
  const tr = [];
  for (let i = 0; i < df.length; i++) {
    const prevClose = i > 0 ? df[i - 1].close : df[i].close;
    tr.push(
      Math.max(
        df[i].high - df[i].low,
        Math.abs(df[i].high - prevClose),
        Math.abs(df[i].low - prevClose)
      )
    );
  }
  return tr;
}

function calculateATRFromTR(tr, period) {
  const atr = [];
  let seedSum = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      seedSum += tr[i];
      atr.push(null);
      if (i === period - 1) {
        atr[i] = seedSum / period; // simple average seed
      }
      continue;
    }
    const prevATR = atr[i - 1];
    atr[i] = (prevATR * (period - 1) + tr[i]) / period; // Wilder smoothing
  }
  return atr;
}

function applySlippage(price, side = "BUY") {
  const slip = price * SLIPPAGE_PCT;
  return side === "BUY" ? price + slip : price - slip;
}

function positionSize(entryPrice, stopLossPrice) {
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);
  if (!riskPerShare || !isFinite(riskPerShare)) return 0;
  const riskAmount = ACCOUNT_SIZE * RISK_PER_TRADE_PCT;
  return Math.max(0, Math.floor(riskAmount / riskPerShare));
}

function findSRZones(df, lookback = SR_LOOKBACK) {
  const recent = df.slice(-lookback);
  const highs = [];
  const lows = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (
      recent[i].high > recent[i - 1].high &&
      recent[i].high > recent[i + 1].high
    )
      highs.push(recent[i].high);
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low)
      lows.push(recent[i].low);
  }
  const support = lows.length
    ? Math.min(...lows)
    : Math.min(...recent.map((r) => r.low));
  const resistance = highs.length
    ? Math.max(...highs)
    : Math.max(...recent.map((r) => r.high));
  return { support, resistance };
}

// === Supertrend Implementation ===
// Returns array of objects: {supertrend: number, direction: 'up'|'down' } aligned with df indices
function calculateSupertrend(df, atrPeriod = SUPER_ATR_PERIOD, multiplier = SUPER_MULTIPLIER) {
  if (!df || df.length === 0) return [];

  // 1) compute TR and ATR
  const tr = calculateTRArray(df);
  const atr = calculateATRFromTR(tr, atrPeriod);

  const final = []; // will hold {upperBand, lowerBand, supertrend, direction}
  let prevFinalUpper = null;
  let prevFinalLower = null;
  let prevSupertrend = null;
  let prevDirection = null;

  for (let i = 0; i < df.length; i++) {
    const hl2 = (df[i].high + df[i].low) / 2;
    const atrVal = atr[i];

    if (!atrVal) {
      final.push({ supertrend: null, direction: null, atr: null, upper: null, lower: null });
      continue;
    }

    const basicUpper = hl2 + multiplier * atrVal;
    const basicLower = hl2 - multiplier * atrVal;

    // finalUpper / finalLower adjust with previous to avoid whipsaws
    let finalUpper = basicUpper;
    let finalLower = basicLower;

    if (prevFinalUpper !== null) {
      finalUpper = (basicUpper < prevFinalUpper || df[i - 1].close > prevFinalUpper) ? basicUpper : prevFinalUpper;
    }
    if (prevFinalLower !== null) {
      finalLower = (basicLower > prevFinalLower || df[i - 1].close < prevFinalLower) ? basicLower : prevFinalLower;
    }

    // determine direction / supertrend value
    let direction;
    let supertrendValue;
    if (prevSupertrend === null) {
      // initial direction: price > basicUpper? up : price < basicLower ? down : neutral -> use close>hl2
      direction = df[i].close > hl2 ? 'up' : 'down';
      supertrendValue = direction === 'up' ? finalLower : finalUpper;
    } else {
      // if previous direction was up
      if (prevDirection === 'up') {
        if (df[i-1].close <= finalUpper) {
          // flip to down
          direction = 'down';
          supertrendValue = finalUpper;
        } else {
          direction = 'up';
          supertrendValue = finalLower;
        }
      } else { // prevDirection == 'down'
        if (df[i-1].close >= finalLower) {
          // flip to up
          direction = 'down';
          supertrendValue = finalUpper;
        } 
        // else {
        //   direction = 'down';
        //   supertrendValue = finalUpper;
        // }
      }
    }

    final.push({
      supertrend: supertrendValue,
      direction,
      atr: atrVal,
      upper: finalUpper,
      lower: finalLower
    });

    // update prevs
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevSupertrend = supertrendValue;
    prevDirection = direction;
  }

  return final;
}

// === Strategy Logic ===
// Use Supertrend direction as primary signal; confirm with a 50-period SMA filter to avoid choppy markets
function analyzeStock(df) {
  const closes = df.map((c) => c.close);
  const smaFilter = calculateSMA(closes, 50); // higher-timeframe trend filter
  const superArr = calculateSupertrend(df, SUPER_ATR_PERIOD, SUPER_MULTIPLIER);

  const n = df.length - 1;
  if (n < Math.max(SUPER_ATR_PERIOD + 2, 50)) {
    return { signal: "NO_DATA" };
  }

  const last = df[n];
  const lastSuper = superArr[n];
  const prevSuper = superArr[n - 1];

  if (!lastSuper || !prevSuper) return { signal: "NO_DATA" };

  // Determine primary trend from Supertrend
  // BUY when Supertrend direction flips to 'up' and price > SMA50
  // SELL when flips to 'down' and price < SMA50
  let signal = "NO_TRADE";

  const sma50 = smaFilter[n];
  if (sma50 === null) return { signal: "NO_DATA" };

  const flippedToUp = prevSuper.direction === 'down' && lastSuper.direction === 'up';
  const flippedToDown = prevSuper.direction === 'up' && lastSuper.direction === 'down';

  if (flippedToUp && last.close > sma50) {
    signal = "BUY";
  } else if (flippedToDown && last.close < sma50) {
    signal = "SELL";
  } else {
    signal = "NO_TRADE";
  }

  // Stoploss / takeprofit
  // use supertrend value as trailing stop reference: for BUY use lastSuper.lower (supertrend value when up), for SELL use lastSuper.upper
  let stopLoss = null;
  let takeProfit = null;
  const atrVal = lastSuper.atr || 0;

  if (signal === "BUY") {
    // entry is current close (adjust for slippage)
    const entry = applySlippage(last.close, "BUY");
    stopLoss = lastSuper.supertrend; // conservative stop: supertrend line
    // if supertrend value is null or >= entry, fallback to entry - 1.5*ATR
    if (!stopLoss || stopLoss >= entry) stopLoss = entry - 1.5 * atrVal;
    takeProfit = entry + 3 * atrVal;
    const qty = positionSize(entry, stopLoss);
    const commission = entry * qty * COMMISSION_PER_TRADE;
    return {
      trend: 'UP',
      signal: 'BUY_PENDING',
      entryPrice: entry,
      stopLoss,
      takeProfit,
      quantity: qty,
      commission,
      atr: atrVal
    };
  } else if (signal === "SELL") {
    const entry = applySlippage(last.close, "SELL");
    stopLoss = lastSuper.supertrend; // supertrend line (upper)
    if (!stopLoss || stopLoss <= entry) stopLoss = entry + 1.5 * atrVal;
    takeProfit = entry - 3 * atrVal;
    const qty = positionSize(entry, stopLoss);
    const commission = entry * qty * COMMISSION_PER_TRADE;
    return {
      trend: 'DOWN',
      signal: 'SELL_PENDING',
      entryPrice: entry,
      stopLoss,
      takeProfit,
      quantity: qty,
      commission,
      atr: atrVal
    };
  }

  return { trend: 'RANGE', signal: 'NO_TRADE' };
}

// === Execution ===
function executeAnalysis() {
  const dataDir = path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) {
    console.log("Data directory not found:", dataDir);
    return;
  }

  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));

  files.forEach((file) => {
    const filePath = path.join(dataDir, file);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.log(`${file}: failed to read/parse ->`, err.message);
      return;
    }

    // Normalize to one or more datasets. Accept:
    // - an array -> treat as single dataset
    // - an object of symbol->array -> analyze each symbol array separately
    const datasets = [];
    if (Array.isArray(json)) {
      datasets.push({ name: file, data: json });
    } else if (json && typeof json === 'object') {
      // if the object maps symbols to arrays (common shape), iterate
      const keys = Object.keys(json);
      if (keys.length > 0 && Array.isArray(json[keys[0]])) {
        keys.forEach((k) => datasets.push({ name: `${file}:${k}`, data: json[k] }));
      } else {
        console.log(`${file}: JSON is an object but not an array-of-arrays - skipping`);
        return;
      }
    } else {
      console.log(`${file}: unexpected JSON type - skipping`);
      return;
    }

    datasets.forEach(ds => {
      const df = (ds.data || []).map((row) => ({
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
      })).filter(r => Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low));

      if (df.length < 60) {
        console.log(`${ds.name}: insufficient data`);
        return;
      }

      const result = analyzeStock(df);
      console.log(`${ds.name}:`, result);
    });
  });
}

// keep existing module export name intact
module.exports = {
  executeStrategy: executeAnalysis
};