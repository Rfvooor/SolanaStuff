const express = require('express');
const rateLimit = require('express-rate-limit');
const { getRecentTokenLaunches, fetchBatchedPairData, getTokenHistoricalPrices, getHolderCount, getTokenSupply } = require('./tokenUtils');
const NodeCache = require('node-cache');
const cors = require('cors');
const app = express();
const port = 3001;

const cache = new NodeCache({ stdTTL: 120 }); // Cache for 2 minutes

// Enable CORS for frontend requests
app.use(cors());

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // limit each IP to 1000 requests per windowMs
});

app.use(limiter);

// API endpoint to fetch tokens data based on the time interval with pagination support
app.get('/tokens/:interval', async (req, res) => {
  const { interval } = req.params;
  const { page = 1, pageSize = 10 } = req.query; // Default to page 1 and pageSize of 10
  const cacheKey = `tokens_${interval}_${page}_${pageSize}`;

  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey));
  }

  try {
    // Fetch recent token launches
    const {recentTransactions, total} = await getRecentTokenLaunches(interval, parseInt(page), parseInt(pageSize));
    const updatedLaunches = await fetchBatchedPairData(recentTransactions);

    const periodMapping = {
      '1hr': 'h1',
      '6hr': 'h6',
      '24hr': 'h24',
      '7d': 'h24',
      '30d': 'h24'
    };

    const fetchPromises = Array.from(updatedLaunches.keys()).map(async address => {
      const hist_prices = await getTokenHistoricalPrices(address, interval);
      const dex_data = updatedLaunches.get(address).dex_data;
      let currentPrice;
      let volume;
      let fdv;
      let dexUrl;

      if (dex_data) {
        currentPrice = parseFloat(dex_data.priceUsd);
        volume = dex_data.volume[periodMapping[interval]];
        fdv = dex_data.fdv;
        dexUrl = dex_data.url;
      } else {
        currentPrice = 0.0;
        volume = 0;
        fdv = 0;
        dexUrl = `https://dexscreener.com/solana/${address}`;
      }
      if (Object.keys(hist_prices).length === 0) {
        return {
          address,
          'currentPrice': currentPrice,
          'ATH': 0,
          'ATL': 0,
          "maxReturn": 0,
          "maxReturnFromListingPrice": 0,
          'returnFromListingPrice': 0,
          'volume': volume,
          'fdv': fdv,
          'dexUrl': `https://dexscreener.com/solana/${address}`,
          'volatility': 0,
          'holderCount': await getHolderCount(address),
          total

        };
      }
      let { ATH, ATL, historicalPrices, maxReturnFromListingPrice, returnFromListingPrice, lastPrice } = hist_prices;
      if(currentPrice==0.0 && lastPrice) {
        currentPrice = lastPrice
      }
      if(fdv==0 && currentPrice) {
        const tokenSupply = await getTokenSupply(address)
        fdv = currentPrice * tokenSupply.value.uiAmount
      }
      
      const maxReturn = currentPrice ? (ATH - currentPrice) / currentPrice : 0;
      const volatility = calculateVolatility(historicalPrices);

      return {
        address,
        currentPrice,
        ATH,
        ATL,
        maxReturn,
        maxReturnFromListingPrice,
        returnFromListingPrice,
        volume: volume,
        fdv: fdv,
        dexUrl: dexUrl,
        volatility,
        holderCount: await getHolderCount(address),
        total
      };
    });

    const tokenData = await Promise.all(fetchPromises);

    // Paginate the results
    const startIndex = (page - 1) * pageSize;
    const paginatedData = tokenData.slice(startIndex, startIndex + pageSize);

    cache.set(cacheKey, paginatedData);
    res.json(paginatedData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching token data' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// Helper function to calculate volatility (standard deviation of returns)
function calculateVolatility(prices) {
  if (!prices || prices.length < 2) return 0;
  const returns = prices.map((price, index) => {
    if (index === 0) return 0;
    return (price - prices[index - 1]) / prices[index - 1];
  }).slice(1); 

  const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
  return Math.sqrt(variance)*100;
}
