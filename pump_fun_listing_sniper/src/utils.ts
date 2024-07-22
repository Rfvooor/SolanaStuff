import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection, connection2 } from "./constants.js";
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT } from "@raydium-io/raydium-sdk";
import BN from "bn.js";
import { mintDataCache } from "./swap.js";

const dexscreenerApi = rateLimit(axios.create(), { maxRequests: 300, perMilliseconds: 60000 });
const birdeyeApi = rateLimit(axios.create(), { maxRequests: 800, perMilliseconds: 60000 });

export async function getHolderCount(address) {
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

export async function getTokenPrice(address) { 
  const response = await birdeyeApi.get(`https://public-api.birdeye.so/defi/price`, {
      params: {
        address: address,
      },
      headers: {
        'X-API-KEY':''
      }
    });
  return response.data.data.value;
}

export async function getSolPrice() {
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

export async function fetchDexData(pairAddresses: string[]) {
  try {
    const chunkSize = 30;
    const addressChunks: string[][] = [];
    const retMap = new Map<string, Object>()
    for (let i = 0; i < pairAddresses.length; i += chunkSize) {
      const chunk: string[] = pairAddresses.slice(i, i + chunkSize);
      addressChunks.push(chunk);
    }

    const requests = addressChunks.map(async chunk => {
      const caList = chunk.join(',');
      const response = await dexscreenerApi.get(`https://api.dexscreener.com/latest/dex/pairs/solana/${caList}`);
      return response.data;
    });

    const responses = await Promise.all(requests);
    console.log(responses)
    responses.forEach(resp => {
      const pairs = resp['pairs'];
      if(pairs) {
        pairs.forEach(p => {
          retMap[p['baseToken']['address']] = p;
        });
      }
    });

    return retMap;
  } catch (error) {
    console.error('Error fetching pair data:', error);
    throw error;
  }
}

export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};


export async function getTokenAccountsByOwner(
  owner: PublicKey,
) {
  const tokenResp = await connection.getTokenAccountsByOwner(
    owner,
    {
      programId: TOKEN_PROGRAM_ID
    },
    "processed"
  );

  const accounts: any = [];

  for (const { pubkey, account } of tokenResp.value) {
    accounts.push({
      pubkey,
      accountInfo:SPL_ACCOUNT_LAYOUT.decode(account.data)
    });
  }

  return accounts;
}

export async function getTokenPriceRaydium(poolKeys): Promise<number|undefined> {
  try {
    if(poolKeys.quoteMint.toString()==NATIVE_MINT.toString()) {
      const solVault = await connection2.getAccountInfo(poolKeys.quoteVault)
      const tokenVault = await connection2.getAccountInfo(poolKeys.baseVault)
      const solVaultData = SPL_ACCOUNT_LAYOUT.decode(solVault!.data)
      const tokenVaultData = SPL_ACCOUNT_LAYOUT.decode(tokenVault!.data)
      return (solVaultData.amount.div(new BN(LAMPORTS_PER_SOL))).toNumber()/(tokenVaultData.amount.div(new BN(10**poolKeys.baseDecimals))).toNumber()
    } else {
      const solVault = await connection2.getAccountInfo(poolKeys.quoteVault)
      const tokenVault = await connection2.getAccountInfo(poolKeys.baseVault)
      const tokenVaultData = SPL_ACCOUNT_LAYOUT.decode(solVault!.data)
      const solVaultData = SPL_ACCOUNT_LAYOUT.decode(tokenVault!.data)
      return (solVaultData.amount.div(new BN(LAMPORTS_PER_SOL))).toNumber()/(tokenVaultData.amount.div(new BN(10**poolKeys.baseDecimals))).toNumber()
    }
  } catch(e) {
    console.log(e)
  }
}


function isCacheStale(updatedDate: Date | undefined, config): boolean {
  if (!updatedDate) return true;
  const now = new Date();
  const diffSeconds = (now.getTime() - updatedDate.getTime()) / 1000;
  return diffSeconds > config.price_cache_ttl;
}

export async function getCachedTokenPrice(tokenAddr, config, poolKeys): Promise<number | undefined> {
  const cache = mintDataCache.get(tokenAddr)
  if(!cache) {
    return;
  }
  const priceCache = cache.priceCache!
  let isTokenPriceStale = true;
  let isSolPriceStale = true;
  if(priceCache) {
    isTokenPriceStale = isCacheStale(priceCache.tokenUpdated, config);
    isSolPriceStale = isCacheStale(priceCache.solUpdated, config);
  }
  

  if (!isTokenPriceStale && !isSolPriceStale && priceCache.tokenAmt !== undefined && priceCache.solAmt !== undefined) {
    return priceCache.solAmt / priceCache.tokenAmt;
  } else {
    const price = await getTokenPriceRaydium(poolKeys);
    return price;
  }
}