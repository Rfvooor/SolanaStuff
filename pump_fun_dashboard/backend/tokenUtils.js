const axios = require('axios');
const rateLimit = require('axios-rate-limit');
const { Connection, PublicKey } = require('@solana/web3.js');
const https = require('https');

const dexscreenerApi = rateLimit(axios.create(), { maxRequests: 300, perMilliseconds: 60000 });
const birdeyeApi = rateLimit(axios.create(), { maxRequests: 800, perMilliseconds: 60000 });


const RAYDIUM_LISTING_PRICE_SOL = 0.00000045 


const keepAliveAgent = new https.Agent({ keepAlive: true });
//const axiosInstance = axios.create();
//const axiosRateLimited = rateLimit(axiosInstance, { maxRPS: 10 });
const connectionConfig = {
    httpAgent: keepAliveAgent, // Use keepAliveAgent for managing socket connections
    commitment: 'confirmed', // Optional commitment level
    //httpHeaders: { 'Content-Type': 'application/json' }, // Optional HTTP headers
    //fetch: axiosRateLimited, // Rate limit fetch function
    disableRetryOnRateLimit: false, 
};

const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=', connectionConfig);
const chainId = 'solana';
const apiUrl = `https://api.dexscreener.com/latest/dex/pairs/${chainId}`;

async function getEpochInfo() {
  const info = await connection.getEpochInfo();
  return info;
}
async function getHolderCount(address) {
  return (await connection.getProgramAccounts(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), {
    filters: [
      {"dataSize": 165},
      {"memcmp": {
        "offset":0,
        "bytes": address
      }
      }
    ]
  })).length
}
async function getSignaturesForAddress(address, startSlot, endSlot, limit = 1000) {
  let allSignatures = [];
  let currSignatures = [];
  let lastSignature;

  while (true) {
    const options = {
      limit,
      before: lastSignature,
    };

    const signatures = await connection.getSignaturesForAddress(new PublicKey(address), options);

    if (signatures.length === 0) break;

    signatures.forEach(sig => {
      if ((!startSlot || sig.slot >= startSlot) && (!endSlot || sig.slot <= endSlot)) {
        currSignatures.push({ signature: sig.signature, slot: sig.slot });
      }
    });

    if (currSignatures.length === 0) break;
    
    allSignatures.push(...currSignatures);
    currSignatures = [];
    lastSignature = signatures[signatures.length - 1].signature;
  }

  return allSignatures;
}

async function getRecentTokenLaunches(timePeriod, page = 1, pageSize = 10, startSlot, endSlot) {
  if (!Number.isInteger(page) || page <= 0) {
    throw new Error("Page number must be a positive integer.");
  }

  if (timePeriod) {
    const { absoluteSlot } = await getEpochInfo();
    const currentSlot = absoluteSlot;
    const averageSlotTime = 0.4;
    if (!endSlot) {
      endSlot = currentSlot;
    }
    if (timePeriod.endsWith('hr')) {
      const hours = parseInt(timePeriod.slice(0, -1), 10);
      startSlot = currentSlot - Math.floor((hours * 3600) / averageSlotTime);
    } else if (timePeriod.endsWith('d')) {
      const days = parseInt(timePeriod.slice(0, -1), 10);
      startSlot = currentSlot - Math.floor((days * 24 * 3600) / averageSlotTime);
    } else if (timePeriod.endsWith('m')) {
      const min = parseInt(timePeriod.slice(0, -1), 10);
      startSlot = currentSlot - Math.floor((min * 60) / averageSlotTime);
    } else {
      throw new Error("Unsupported time period format. Use 'hr' for hours, 'd' for days or 'm' for minutes.");
    }
  }
  
  const signatures = await getSignaturesForAddress('39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg', startSlot, endSlot);
  const total = signatures.length/3;
  
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  let fetchedCount = 0;

  const recentTransactions = new Map();
  for (const signature of signatures) {
    const txDetails = await connection.getParsedTransaction(signature.signature, { maxSupportedTransactionVersion: 1 });

    const pumpString = txDetails.transaction.message.accountKeys.map(e => e.pubkey.toString()).find(str => /pump$/.test(str));
    if(pumpString) {
      fetchedCount++;
      if(startIndex<=fetchedCount<=endIndex) {
        recentTransactions.set(pumpString, { 'date': new Date(txDetails.blockTime * 1000), 'hash': txDetails.transaction.signatures[0] });
      }
    }
    if(recentTransactions.keys().length==pageSize) {
      break;
    }
  }

  return { recentTransactions, total };
}


async function fetchBatchedPairData(pairAddresses) {
  try {
    const chunkSize = 30;
    const addressChunks = [];

    for (let i = 0; i < pairAddresses.size; i += chunkSize) {
      const chunk = Array.from(pairAddresses.keys()).slice(i, i + chunkSize);
      addressChunks.push(chunk);
    }

    const requests = addressChunks.map(async chunk => {
      const caList = chunk.map(pair => pair.ca).join(',');
      const response = await dexscreenerApi.get(`${apiUrl}/${caList}`);
      return response.data;
    });

    const responses = await Promise.all(requests);

    responses.forEach(resp => {
      const pairs = resp['pairs'];
      if(pairs) {
        pairs.forEach(p => {
          const curr = pairAddresses.get(p['baseToken']['address']);
          curr['dex_data'] = p;
          pairAddresses.set(p['baseToken']['address'], curr);
        });
      }
    });

    return pairAddresses;
  } catch (error) {
    console.error('Error fetching pair data:', error);
    throw error;
  }
}

async function getSolPrice() {
  const response = await birdeyeApi.get(`https://public-api.birdeye.so/defi/price`, {
      params: {
        address: 'So11111111111111111111111111111111111111112',
      },
      headers: {
        'X-API-KEY':''
      }
    });
  return response.data.data.value;
}

async function getTokenHistoricalPrices(tokenAddress, interval) {
  try {
    const periodMapping = {
      '1hr': '1m',
      '6hr': '5m',
      '24hr': '15m',
      '7d': '12h',
      '30d': '1d'
    };

    const timeUnit = periodMapping[interval] || '1m';
    const now = Math.floor(Date.now() / 1000);
    const timeTo = now;
    const timeFrom = interval === '7d' ? now - (7 * 24 * 3600) : interval === '30d' ? now - (30 * 24 * 3600) : now - (24 * 3600);

    const response = await birdeyeApi.get(`https://public-api.birdeye.so/defi/history_price`, {
      params: {
        address: tokenAddress,
        address_type: 'token',
        type: timeUnit,
        time_from: timeFrom,
        time_to: timeTo
      },
      headers: {
        'X-API-KEY':''
      }
    });

    const historicalPrices = response.data.data.items || [];
    if(historicalPrices.length==0) {
      return {};
    }
    const lastPrice= parseFloat(historicalPrices[historicalPrices.length - 1].value) 
    let ATH = Number.MIN_SAFE_INTEGER;
    let ATL = Number.MAX_SAFE_INTEGER;

    historicalPrices.forEach(priceData => {
      const price = parseFloat(priceData.value);

      if (price > ATH) ATH = price;
      if (price < ATL) ATL = price;
    });
    RAYDIUM_LISTING_PRICE_USD = RAYDIUM_LISTING_PRICE_SOL * (await getSolPrice())
    const returnFromListingPrice = ((lastPrice - RAYDIUM_LISTING_PRICE_USD) / RAYDIUM_LISTING_PRICE_USD) ;
    const maxReturnFromListingPrice = ((ATH - RAYDIUM_LISTING_PRICE_USD) / RAYDIUM_LISTING_PRICE_USD) ;
    return { ATH, ATL, historicalPrices: historicalPrices.map(p => parseFloat(p.value)), returnFromListingPrice, maxReturnFromListingPrice, lastPrice};
  } catch (error) {
    console.error('Error fetching historical prices:', error);
    throw error;
  }
}

async function getTokenSupply(tokenAddress) {
  return await connection.getTokenSupply(new PublicKey(tokenAddress))
}


module.exports = {
  getEpochInfo,
  getSignaturesForAddress,
  getRecentTokenLaunches,
  fetchBatchedPairData,
  getTokenHistoricalPrices,
  getHolderCount,
  getSolPrice,
  getTokenSupply
};
