import pkg, { Liquidity, LiquidityPoolKeysV4, MARKET_STATE_LAYOUT_V2, MARKET_STATE_LAYOUT_V3, SPL_ACCOUNT_LAYOUT } from '@raydium-io/raydium-sdk';
import { getAssociatedTokenAddressSync, NATIVE_MINT, unpackMint } from '@solana/spl-token';
import { Commitment, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import https from 'node:https';
import BN from 'bn.js';


export interface MintData {
  poolKeys?: LiquidityPoolKeysV4,
  priceCache?: PriceCache
}

export interface PriceCache {
  tokenAmt?: number
  solAmt?: number
  tokenUpdated?: Date
  solUpdated?: Date
  closeAccountListeners?: Array<Function>
  tokenAccount?: any
}
const OPENBOOK_PROGRAM_ID = new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX');
const RAYDIUM_POOL_V4_PROGRAM_ID = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const mintDataCache = new Map<string, MintData>();
const HELIUS_RPC_URL = ""
const HELIUS_WSS_RPC_URL = ""
const keepaliveAgent = new https.Agent({
  timeout: 10_000,
  maxSockets: 2048,
});
export const connection = new Connection(HELIUS_RPC_URL, {
  disableRetryOnRateLimit: false,
  httpAgent: keepaliveAgent,
  wsEndpoint: HELIUS_WSS_RPC_URL
});


async function getSerumMarketForToken(
  tokenMint: string,
  commitment: Commitment =  "confirmed",
): Promise<any> {
  const { span } = MARKET_STATE_LAYOUT_V3;
  const filters: Array<any> = [{ dataSize: span },
    {
      memcmp: {
        offset: MARKET_STATE_LAYOUT_V2.offsetOf('baseMint'),
        bytes: tokenMint,
      },
    }
  ]
  const account = await connection.getProgramAccounts(OPENBOOK_PROGRAM_ID, {
    commitment: commitment,
    filters: filters,
  });
  if(account.length>0) {
    return account[0]
  } else {
    const { span } = MARKET_STATE_LAYOUT_V3;
  const filters: Array<any> = [{ dataSize: span },
    {
      memcmp: {
        offset: MARKET_STATE_LAYOUT_V2.offsetOf('quoteMint'),
        bytes: tokenMint,
      },
    }
  ]
  const account = await connection.getProgramAccounts(OPENBOOK_PROGRAM_ID, {
    commitment: commitment,
    filters: filters,
  });
  if(account.length>0) {
    return account[0]
  }
  }
  return null;
}

const getPoolKeys = async (addr: string) => {
  if(mintDataCache.has(addr)  && 'poolKeys' in mintDataCache.get(addr)!) {
    return mintDataCache.get(addr)?.poolKeys!
  }
  const market = await getSerumMarketForToken(addr, "processed");
  const tokenAddr = new PublicKey(addr);
  const tokenAccountInfo = await connection.getAccountInfo(tokenAddr);
  const mintInfo = unpackMint(tokenAddr, tokenAccountInfo);
  const marketData = MARKET_STATE_LAYOUT_V3.decode(
    market.account.data
  );
  const baseMint = marketData.baseMint;
  const quoteMint = marketData.quoteMint;
  const marketKeys = {
    marketBaseVault: marketData.baseVault,
    marketQuoteVault: marketData.quoteVault,
    marketBids: marketData.bids,
    marketAsks: marketData.asks,
    marketEventQueue: marketData.eventQueue,
  }
  const poolInfo = Liquidity.getAssociatedPoolKeys({
    version: 4,
    marketVersion: 3,
    marketId: market.pubkey,
    baseMint: baseMint,
    quoteMint: quoteMint,
    baseDecimals: mintInfo.decimals,
    quoteDecimals: 9,
    programId: RAYDIUM_POOL_V4_PROGRAM_ID,
    marketProgramId: OPENBOOK_PROGRAM_ID,
  })
  const poolKeys = { ...poolInfo, ...marketKeys };
  let curr;
  if(mintDataCache.has(addr)) {
    curr = mintDataCache.get(addr)
    curr!.poolKeys = poolKeys 
  } else {
    curr = {priceCache: {closeAccountListeners: []} as PriceCache, poolKeys: poolKeys}
  }
  mintDataCache.set(tokenAddr.toString(),curr)
  console.log(`token addr: ${tokenAddr}, ${mintDataCache.has(tokenAddr.toString())}`)
  return poolKeys;
}

function processTokenAccountChange(accountInfo, tokenAddr) {
  const taData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
  const curr = mintDataCache.get(tokenAddr)
  let priceCache = {} as PriceCache
  if(curr && "priceCache" in curr) {
    priceCache = curr.priceCache!
  }
  priceCache.tokenAccount = taData
  curr!["priceCache"] = priceCache
  mintDataCache.set(tokenAddr, curr!)
  return "";
}

function processAccountDataQuote(accountInfo, poolKeys) { 
  if(poolKeys.quoteMint.toString()==NATIVE_MINT.toString()) {
    const curr = mintDataCache.get(poolKeys.baseMint.toString())!
    if(!curr) {
      return;
    }
    let priceCache = {} as PriceCache
    if("priceCache" in curr) {
      priceCache = curr.priceCache!
    }
    const solVaultData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
    priceCache.solAmt = solVaultData.amount.div(new BN(LAMPORTS_PER_SOL)).toNumber()
    priceCache.solUpdated = new Date();
    curr["priceCache"] = priceCache
    mintDataCache.set(poolKeys.baseMint.toString(), curr!)
  } else {
    const curr = mintDataCache.get(poolKeys.quoteMint.toString())!
    if(!curr) {
      return;
    }
    let priceCache = {} as PriceCache
    if("priceCache" in curr) {
      priceCache = curr.priceCache!
    }
    const tokenVaultData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
    priceCache.tokenAmt = tokenVaultData.amount.div(new BN(10**poolKeys.baseDecimals)).toNumber()
    priceCache.tokenUpdated = new Date();
    curr["priceCache"] = priceCache
    mintDataCache.set(poolKeys.quoteMint.toString(), curr!)
  }
}

async function getTokenPriceRaydium(poolKeys): Promise<number|undefined> {
  try {
    if(poolKeys.quoteMint.toString()==NATIVE_MINT.toString()) {
      const solVault = await connection.getAccountInfo(poolKeys.quoteVault)
      const tokenVault = await connection.getAccountInfo(poolKeys.baseVault)
      const solVaultData = SPL_ACCOUNT_LAYOUT.decode(solVault!.data)
      const tokenVaultData = SPL_ACCOUNT_LAYOUT.decode(tokenVault!.data)
      return (solVaultData.amount.div(new BN(LAMPORTS_PER_SOL))).toNumber()/(tokenVaultData.amount.div(new BN(10**poolKeys.baseDecimals))).toNumber()
    } else {
      const solVault = await connection.getAccountInfo(poolKeys.quoteVault)
      const tokenVault = await connection.getAccountInfo(poolKeys.baseVault)
      const tokenVaultData = SPL_ACCOUNT_LAYOUT.decode(solVault!.data)
      const solVaultData = SPL_ACCOUNT_LAYOUT.decode(tokenVault!.data)
      return (solVaultData.amount.div(new BN(LAMPORTS_PER_SOL))).toNumber()/(tokenVaultData.amount.div(new BN(10**poolKeys.baseDecimals))).toNumber()
    }
  } catch(e) {
    console.log(e)
  }
}
async function logPriceAndValue(tokenAddr) {
  let curr = mintDataCache.get(tokenAddr);
  const poolKeys = curr!.poolKeys
  const taData = curr!.priceCache!.tokenAccount
  let bal;
  if(taData) {
    bal = parseBalFromTaData(taData, poolKeys)
  }
  const price = await getCachedTokenPrice(tokenAddr, poolKeys)
  console.log(`price for ${tokenAddr} is ${price}`)
  console.log(`bal for ${tokenAddr} is ${bal}`)
  console.log(`sol value for ${tokenAddr} is ${bal * price!}`)
}

function isCacheStale(updatedDate: Date | undefined,price_cache_ttl = 2): boolean {
  if (!updatedDate) return true;
  const now = new Date();
  const diffSeconds = (now.getTime() - updatedDate.getTime()) / 1000;
  return diffSeconds > price_cache_ttl;
}

async function getCachedTokenPrice(tokenAddr, poolKeys): Promise<number | undefined> {
  const cache = mintDataCache.get(tokenAddr)
  if(!cache) {
    return;
  }
  const priceCache = cache.priceCache!
  let isTokenPriceStale = true;
  let isSolPriceStale = true;
  if(priceCache) {
    isTokenPriceStale = isCacheStale(priceCache.tokenUpdated);
    isSolPriceStale = isCacheStale(priceCache.solUpdated);
  }
  

  if (!isTokenPriceStale && !isSolPriceStale && priceCache.tokenAmt !== undefined && priceCache.solAmt !== undefined) {
    return priceCache.solAmt / priceCache.tokenAmt;
  } else {
    const price = await getTokenPriceRaydium(poolKeys);
    return price;
  }
}

function processAccountDataBase(accountInfo, poolKeys) { 
  if(poolKeys.quoteMint.toString()==NATIVE_MINT.toString()) {
    const curr = mintDataCache.get(poolKeys.baseMint.toString())!
    if(!curr) {
      return;
    }
    let priceCache = {} as PriceCache
    if("priceCache" in curr) {
      priceCache = curr.priceCache!
    }
    const solVaultData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
    priceCache.tokenAmt = solVaultData.amount.div(new BN(10**poolKeys.baseDecimals)).toNumber()
    priceCache.tokenUpdated = new Date();
    curr["priceCache"] = priceCache
    mintDataCache.set(poolKeys.baseMint.toString(), curr!)
    
  } else {
    const curr = mintDataCache.get(poolKeys.quoteMint.toString())!
    if(!curr) {
      return;
    }
    let priceCache = {} as PriceCache
    if("priceCache" in curr) {
      priceCache = curr.priceCache!
    }
    const tokenVaultData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
    priceCache.solAmt = tokenVaultData.amount.div(new BN(LAMPORTS_PER_SOL)).toNumber()
    priceCache.solUpdated = new Date();
    curr["priceCache"] = priceCache
    mintDataCache.set(poolKeys.quoteMint.toString(), curr!)
  }
}

const closeListeners = (quoteListener, tokenListener, taListener) => {
  const closeCallbacks: Array<Function> = [];

  closeCallbacks.push(() => connection.removeAccountChangeListener(quoteListener));
  closeCallbacks.push(() => connection.removeAccountChangeListener(tokenListener));
  closeCallbacks.push(() => connection.removeAccountChangeListener(taListener));

  return closeCallbacks;
};

async function startListeners(poolKeys, pubkey?) {
  const tokenAddr = [poolKeys.baseMint, poolKeys.quoteMint].map(e => e.toString()).find(str => /pump$/.test(str));
  const curr = mintDataCache.get(tokenAddr)!
  if("priceCache" in curr) {
    return;
  }
  const quoteListener = connection.onAccountChange(
    poolKeys.quoteVault, (accountInfo) => {
      processAccountDataQuote(accountInfo, poolKeys)
      logPriceAndValue(tokenAddr)
    }, "processed"
  )
  const baseListener = connection.onAccountChange(
    poolKeys.baseVault, (accountInfo) => {
      processAccountDataBase(accountInfo, poolKeys)
    }, "processed"
  )
  const taListener = connection.onAccountChange(
    getAssociatedTokenAddressSync(new PublicKey(tokenAddr), pubkey), (accountInfo) => {
      processTokenAccountChange(accountInfo, tokenAddr)
      console.log()
      }, "processed"
  )
  curr.priceCache = {
    closeAccountListeners: closeListeners(quoteListener, baseListener, taListener),
  }
  mintDataCache.set(poolKeys.quoteMint.toString(), curr!)
}

function parseBalFromTaData(taData, poolKeys) {
  const decimals = poolKeys.baseMint.toString() === NATIVE_MINT.toString() ? poolKeys.baseDecimals : poolKeys.quoteDecimals;
  let bal;
  try {
    bal = taData.amount.toNumber() / (10**decimals)
  } catch{
    bal = taData.amount.div(new BN(10 ** decimals)).toNumber();
  }
  return bal;
}

async function listenToTokenRealTime(tokenAddr: string, addressToWatch?: string) {
  const poolKeys = await getPoolKeys(tokenAddr)
  startListeners(poolKeys, addressToWatch)
}

listenToTokenRealTime("", "")