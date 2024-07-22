import { Commitment, ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

//import { MARKET_STATE_LAYOUT_V3, MARKET_STATE_LAYOUT_V2, LiquidityPoolKeysV4, Liquidity, Percent, Token,TokenAmount } from '@raydium-io/raydium-sdk';
import pkg, { BigNumberish, Currency, CurrencyAmount, LIQUIDITY_STATE_LAYOUT_V4, LiquidityPoolKeysV4, SPL_ACCOUNT_LAYOUT } from '@raydium-io/raydium-sdk';
const { MARKET_STATE_LAYOUT_V3, MARKET_STATE_LAYOUT_V2, Liquidity, Percent, Token } = pkg;
import {NATIVE_MINT, TOKEN_PROGRAM_ID, burnCheckedInstructionData, createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction, createBurnInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, getMint, unpackMint } from '@solana/spl-token';
import bs58 from 'bs58';
import { OPENBOOK_PROGRAM_ID, RAYDIUM_POOL_V4_PROGRAM_ID, connection, connection2 } from "./constants.js";
import { getCachedTokenPrice, getSolPrice, getTokenAccountsByOwner, getTokenPrice, getTokenPriceRaydium, sleep } from './utils.js';
import { PoolFilters } from './filters.js';
export const mintDataCache = new Map<string, MintData>();
import BN from 'bn.js'
import { clearInterval } from 'timers';

export interface MintData {
  poolKeys?: LiquidityPoolKeysV4,
  lastPosVal?: number,
  trailingStopInfo?: any,
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

export interface TradeConfig {
  payerKey?: Keypair,
  side: boolean,
  amt_in: BigNumberish, 
  poolKeys?: LiquidityPoolKeysV4, 
  slippage?: number,
  limit_mc_sol?: number, 
  recentblockHash?: string, 
  callbacks?: CallableFunction[], 
  maxAttempts?: number,
  fee?: number,
  sellInterval?: number,
  filterCheckInterval?: number,
  filterCheckDuration?: number,
  poolFilters?: PoolFilters,
  consecutiveMatchCount?: number,
  trailingStopPercentage?: number,
  stopLoss?: number, 
  price_cache_ttl?: number
  sellLevels?: { level: number; percentage: number }[];
  logs: boolean
  maxFee?: number
}

function parseBalFromTaData(tokenAddr,cache?) {
  cache = cache || mintDataCache.get(tokenAddr)
  const poolKeys = cache.poolKeys
  const decimals = poolKeys.baseMint.toString() === NATIVE_MINT.toString() ? poolKeys.baseDecimals : poolKeys.quoteDecimals;
  const taData = cache.priceCache.tokenAccount;
  let bal;
  try {
    bal = taData.amount.toNumber() / (10**decimals)
  } catch{
    bal = taData.amount.div(new BN(10 ** decimals)).toNumber();
  }
  return bal;
}
function updateTaForCache(tokenAddr, ta,cache?) {
  cache = cache || mintDataCache.get(tokenAddr)
  const taData = SPL_ACCOUNT_LAYOUT.decode(ta.data)
  if (cache) {
    cache.priceCache!.tokenAccount = taData;
    mintDataCache.set(tokenAddr, cache);
  }
}
function sendTransaction(transaction, skipPreflight, maxRetries, confirm, blockhash,currAttempt=0,confirmCallback?, failCallback?) {
  return connection.sendTransaction(transaction, { skipPreflight: skipPreflight, maxRetries: maxRetries}).then(
    (sig)=> {
      if(confirm) {
        connection2.getBlockHeight("confirmed").then(
          (bh)=> {
            try {
                connection2.confirmTransaction({signature: sig, blockhash:blockhash.blockhash, lastValidBlockHeight:bh}, "confirmed").then(
                  (value)=> {
                    if(value.value.err) {
                      if(currAttempt>maxRetries)
                        sendTransaction(transaction, skipPreflight, maxRetries, confirm, currAttempt+1, confirmCallback, failCallback)
                    } else {
                      if(confirmCallback)
                        confirmCallback(sig);
                      return sig;
                    }
                  },()=>{
                    if(failCallback)
                      failCallback(sig);
                    if(currAttempt>maxRetries)
                      sendTransaction(transaction, skipPreflight, maxRetries, confirm, currAttempt+1, confirmCallback, failCallback)
                    return sig;
                  })
            } catch {
              if(currAttempt>maxRetries)
                sendTransaction(transaction, skipPreflight, maxRetries, confirm, currAttempt+1, confirmCallback, failCallback)
            }
          }, (err)=>{
            console.log("failed to fetch blockheight: ", err)
          }
        )
      } else {
        return sig;
      }
    }, (err)=> {sendTransaction(transaction, skipPreflight, maxRetries, confirm, currAttempt+1, confirmCallback, failCallback)}
  )

}
async function processSellStratFromTa(tokenAddr: string, config: TradeConfig, taAddr: PublicKey) {
  let curr = mintDataCache.get(tokenAddr);
  const payerKey = config.payerKey!
  const taData = curr!.priceCache!.tokenAccount
  const bal = parseBalFromTaData(tokenAddr, curr)
  const poolKeys = curr!.poolKeys
  let ins;
  if (bal<.00005 && bal>0) {
    ins = [ createBurnInstruction(taAddr, new PublicKey(tokenAddr), payerKey.publicKey, taData.amount), createCloseAccountInstruction(taAddr, payerKey.publicKey, payerKey.publicKey)];
    connection2.getLatestBlockhash().then(
      (bh)=> {
        try {
        const messageV0 = new TransactionMessage({
          payerKey: payerKey.publicKey,
          recentBlockhash: bh.blockhash,
          instructions: ins,
        }).compileToV0Message();
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([payerKey]);
        sendTransaction(transaction, true, 1, true, bh, 0, 

        )
      } catch(err) {
        processSellStratFromTa(tokenAddr, config, taAddr)
      }
      },
      (err)=> {console.log(err)},
    )
    removeListeners(tokenAddr)
    mintDataCache.delete(tokenAddr)
    return;
  }
  if( bal === 0 || bal === new BN(0)) {
    ins = [ createCloseAccountInstruction(taAddr, payerKey.publicKey, payerKey.publicKey)];
    connection2.getLatestBlockhash().then(
      (bh)=> {
        try {
        const messageV0 = new TransactionMessage({
          payerKey: payerKey.publicKey,
          recentBlockhash: bh.blockhash,
          instructions: ins,
        }).compileToV0Message();
        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([payerKey]);
        
        sendTransaction(transaction, true, 1, true, bh, 0)
        removeListeners(tokenAddr)
        mintDataCache.delete(tokenAddr)
      } catch(err) {
        processSellStratFromTa(tokenAddr, config, taAddr)
      }
      },
      (err)=> {console.log(err)},
    )
    return;
  }
  if(config.logs) {
    console.log(`readable bal for ${tokenAddr} is ${bal}`)
  }
  let posValLamports;
  let price = await getCachedTokenPrice(tokenAddr, config, poolKeys);
  if(config.logs) {
    console.log(`Updated cached price for ${tokenAddr} is ${price}`)
  }
  if (price) {
    posValLamports = bal * price //* LAMPORTS_PER_SOL;
  } else {
    price = await getTokenPrice(tokenAddr);
    const posVal = bal * price!;
    const solPrice = await getSolPrice();
    posValLamports = (posVal / solPrice) //* LAMPORTS_PER_SOL;

    price = price!/solPrice
    if(config.logs) {
      console.log(`Updated price for ${tokenAddr} is ${price}`)
    }
  }
  if(config.logs) {
    console.log(`Updated value for ${tokenAddr} is ${posValLamports}`)
  }
    //@ts-ignore
  if((posValLamports <= (config.amt_in * (1 - (config.stopLoss / 100))))) {
    swapFromCa(tokenAddr,{ side: false, amt_in: taData.amount, poolKeys: poolKeys, fee: 0, logs:config.logs, payerKey: config.payerKey, maxAttempts:1 } )
  }

  // Retrieve or initialize the trailing stop info for this token
  let trailingStopInfo;
  if(config.trailingStopPercentage) {
    if (curr && 'trailingStopInfo' in curr!) {
      trailingStopInfo = curr!.trailingStopInfo;
    } else {
      trailingStopInfo = { peakPrice: 0, trailingStopPrice: 0 };
      trailingStopInfo.peakPrice = posValLamports;
      trailingStopInfo.trailingStopPrice = trailingStopInfo.peakPrice * (1 - (config.trailingStopPercentage / 100));
    }

    // Update the peak price and trailing stop price
    if (posValLamports > trailingStopInfo.peakPrice) {
      trailingStopInfo.peakPrice = posValLamports;
      trailingStopInfo.trailingStopPrice = trailingStopInfo.peakPrice * (1 - (config.trailingStopPercentage / 100));
    }
  }
  if(config.logs) {
    console.log(`Updated trailing stop for ${tokenAddr} is peak val: ${trailingStopInfo.peakPrice} trailingStopVal: ${trailingStopInfo.trailingStopPrice}`)
  }

  // Check if the current position value in SOL has hit any sell levels
  if(config.sellLevels) {
    for (const { level, percentage } of config.sellLevels) {
      //@ts-ignore
      if (posValLamports >= config.amt_in * level && !trailingStopInfo[`soldAt${level}x`]) {
        // Sell a percentage of the position
        const sellAmount = taData.amount.mul(new BN(percentage)).div(new BN(100));
        swapFromCa(tokenAddr,{ side: false, amt_in: sellAmount, poolKeys: poolKeys, fee: 0, logs:config.logs, payerKey: config.payerKey, maxAttempts:1 } )
        // Mark this level as sold
        trailingStopInfo[`soldAt${level}x`] = true;
      }
    }
  }

  
  
  if (trailingStopInfo && (posValLamports <= trailingStopInfo.trailingStopPrice)) {
    swapFromCa(tokenAddr,{ side: false, amt_in: taData.amount.mul(new BN(20)).div(new BN(100)), poolKeys: poolKeys, fee: 0, logs:config.logs, payerKey: config.payerKey, maxAttempts:1 } )
  } 
  if (curr) {
    curr.trailingStopInfo = trailingStopInfo;
    mintDataCache.set(tokenAddr, curr);
  }
}
function processSellStrat(config: TradeConfig, tokenAddr: string) {
  try {
    const payerKey = config.payerKey!
    const taAddr = getAssociatedTokenAddressSync(new PublicKey(tokenAddr), payerKey.publicKey)
    let cache = mintDataCache.get(tokenAddr)
    if(!cache || !cache.priceCache) {
      return;
    }
    let taData = cache!.priceCache!.tokenAccount
    if(!taData) {
      connection.getAccountInfo(taAddr, "processed").then(
        async (ta) => {
          try {
            if(ta) {
              updateTaForCache(tokenAddr, ta)
              processSellStratFromTa(tokenAddr, config, taAddr)
            } else {
              removeListeners(tokenAddr)
              mintDataCache.delete(tokenAddr)
              return;
            }
          } catch(err) {
            console.log(err)
          }
        }, 
        ()=> {
          if(config.logs)
            console.log("returning due to no ta")
          return
        }
      )
    } else {
      processSellStratFromTa(tokenAddr, config, taAddr)
    }
  } catch (e) {
    console.log(e);
  }
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
    } else {
      return;
    }
    const solVaultData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
    priceCache.solAmt = solVaultData.amount.div(new BN(LAMPORTS_PER_SOL)).toNumber()
    priceCache.solUpdated = new Date();
    if(mintDataCache.has(poolKeys.baseMint.toString())) {
      curr["priceCache"] = priceCache
      mintDataCache.set(poolKeys.baseMint.toString(), curr!)
    }
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
    if(mintDataCache.has(poolKeys.baseMint.toString())) {
      curr["priceCache"] = priceCache
      mintDataCache.set(poolKeys.quoteMint.toString(), curr!)
    }
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
    } else {
      return;
    }
    const solVaultData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
    priceCache.tokenAmt = solVaultData.amount.div(new BN(10**poolKeys.baseDecimals)).toNumber()
    priceCache.tokenUpdated = new Date();
    if(mintDataCache.has(poolKeys.baseMint.toString())) {
      curr["priceCache"] = priceCache
      mintDataCache.set(poolKeys.baseMint.toString(), curr!)
    }
    
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
    if(mintDataCache.has(poolKeys.baseMint.toString())) {
      curr["priceCache"] = priceCache
      mintDataCache.set(poolKeys.quoteMint.toString(), curr!)
    }
  }
}
function processTokenAccountChange(accountInfo, tokenAddr, config) {
  let taData;
  if(accountInfo.data) {
    taData = SPL_ACCOUNT_LAYOUT.decode(accountInfo.data)
  } else {
    taData = accountInfo
  }
  if(!taData) {
    connection2.getAccountInfo(getAssociatedTokenAddressSync(new PublicKey(tokenAddr), config.payerKey.publicKey), "processed").then(
      (ta) => {
        try {
          if(ta) {
            updateTaForCache(tokenAddr, ta)
            return;
          } else {
            removeListeners(tokenAddr)
            mintDataCache.delete(tokenAddr)
            return;
          }
        } catch(err) {
          console.log(err)
        }
      }, 
      ()=> {
        if(config.logs)
          console.log("returning due to no ta")
        return
      }
    )
    return;
  }
  if (taData.amount.eq(new BN(0))) {
    connection2.getLatestBlockhash().then(
        (blockhash)=> {
          try{
          const ins = [createCloseAccountInstruction(getAssociatedTokenAddressSync(new PublicKey(tokenAddr), config.payerKey.publicKey), config.payerKey.publicKey, config.payerKey.publicKey)];
          const messageV0 = new TransactionMessage({
            payerKey: config.payerKey.publicKey,
            recentBlockhash: blockhash.blockhash,
            instructions: ins,
          }).compileToV0Message();
          const transaction = new VersionedTransaction(messageV0);
          transaction.sign([config.payerKey]);
          sendTransaction(transaction, true, 1, true, blockhash, 0, 
            (_)=>{
              removeListeners(tokenAddr)
              mintDataCache.delete(tokenAddr)
            }, 
            (_)=>{
              processTokenAccountChange(accountInfo, tokenAddr, config)
            })
        }catch {
          processTokenAccountChange(accountInfo, tokenAddr, config)
        }
        }, 
      )
  }
  const curr = mintDataCache.get(tokenAddr)
  if(!curr) {
    return;
  }
  let priceCache = {} as PriceCache
  if(curr && "priceCache" in curr) {
    priceCache = curr.priceCache!
  }
  priceCache.tokenAccount = taData
  if(mintDataCache.has(tokenAddr)) {
    curr["priceCache"] = priceCache
    mintDataCache.set(tokenAddr, curr!)
  }
}
  

export function startVaultListeners(poolKeys, config, tokenAccount) {
  const tokenAddr = [poolKeys.baseMint, poolKeys.quoteMint].map(e => e.toString()).find(str => /pump$/.test(str));
  const curr = mintDataCache.get(tokenAddr)!
  const quoteListener = connection.onAccountChange(
    poolKeys.quoteVault, (accountInfo) => {
      processAccountDataQuote(accountInfo, poolKeys)
      processSellStrat(config, tokenAddr)
    }, "processed"
  )
  const baseListener = connection.onAccountChange(
    poolKeys.baseVault, (accountInfo) => {
      processAccountDataBase(accountInfo, poolKeys)
    }, "processed"
  )
  const taListener = connection.onAccountChange(
    getAssociatedTokenAddressSync(new PublicKey(tokenAddr), config.payerKey.publicKey), (accountInfo) => {
      processTokenAccountChange(accountInfo, tokenAddr, config)}, "processed"
  )
  if(config.logs) {
    console.log(`started listeners for ${tokenAddr} `)
  }
  curr.priceCache = {
    closeAccountListeners: closeListeners(quoteListener, baseListener, taListener),
    tokenAccount: tokenAccount
  }
  mintDataCache.set(tokenAddr, curr)
  if(tokenAccount) {
    processTokenAccountChange(tokenAccount, tokenAddr, config)
  }
}

export async function getSerumMarketForToken(
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

export const getPoolKeys = async (addr: string) => {
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
  return poolKeys;
}
function calculateMetrics(recentPrioritizationFees) {
  const totalPrioritizationFee = recentPrioritizationFees.reduce((sum, item) => sum + item.prioritizationFee, 0);
  const average = totalPrioritizationFee / recentPrioritizationFees.length;
  const highest = Math.max(...recentPrioritizationFees.map(item => item.prioritizationFee));
  const sortedFees = recentPrioritizationFees.map(item => item.prioritizationFee).sort((a, b) => a - b);
  const medianIndex = Math.floor(sortedFees.length / 2);
  const median = sortedFees.length % 2 === 0 ? (sortedFees[medianIndex - 1] + sortedFees[medianIndex]) / 2 : sortedFees[medianIndex];

  return {
      avg: Math.ceil(average),
      high: Math.ceil(highest),
      med: Math.ceil(median)
  };
}

export const getFeeForPoolkeys = async (poolkeys) => {
  const fees = await connection2.getRecentPrioritizationFees({lockedWritableAccounts: [poolkeys.id, poolkeys.openOrders, poolkeys.targetOrders, poolkeys.marketId, poolkeys.quoteVault, poolkeys.baseVault]})
  return calculateMetrics(fees)
}

export const getPoolInfo = async (poolKeys) => {
  try {
    const updatedPoolInfo = await Liquidity.fetchInfo({connection: connection, poolKeys: poolKeys})
    return updatedPoolInfo;
  } catch (error) {
    try {
      const poolAcc = await connection.getAccountInfo(poolKeys.id, "processed");
      const baseVault = await connection.getAccountInfo(poolKeys.baseVault, "processed");
      const quoteVault = await connection.getAccountInfo(poolKeys.quoteVault, "processed");
      const data = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAcc!.data) 
      const base = SPL_ACCOUNT_LAYOUT.decode(baseVault!.data)
      const quoteVaultData = SPL_ACCOUNT_LAYOUT.decode(quoteVault!.data)
      return {
        status: data.status,
        baseDecimals: data.baseDecimal.toNumber(),
        quoteDecimals: data.quoteDecimal.toNumber(),
        lpDecimals: poolKeys.lpDecimals,
        baseReserve: base.amount,
        quoteReserve: quoteVaultData.amount,
        lpSupply: data.lpReserve,
        startTime: new BN(10),
      }
    } catch (err) {
      console.warn('failed to get poolInfo', err)
    }
  } 
}

export const raydiumSwap = async (
  config: TradeConfig, 
  payer: Keypair, 
  rawAmtIn: BigNumberish,
  tokenAccountIn: PublicKey, 
  tokenAccountOut: PublicKey, 
  minAmountOut: BigNumberish=1, 
  recentBlockhash?: string,
  skipPreflight: boolean=false
  ) => {
  try {
    let innerTxns;
    const poolKeys = config.poolKeys!
    const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint
    let fee = 50_000;
    if(config.fee && !isNaN(config.fee)) {
      fee = config.fee
    }
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: tokenAccountIn,
          tokenAccountOut: tokenAccountOut,
          owner: payer.publicKey,
        },
        amountIn: rawAmtIn.toString(),
        minAmountOut: minAmountOut.toString(),
      },
      poolKeys.version,
    );
    innerTxns = innerTransaction;
    let ins;

    ins = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000}),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(fee) }),
      ...innerTxns.instructions,
    ]
    if(config.side) {
      ins = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000}),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(fee) }),
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, tokenAccountOut, payer.publicKey, token),
        ...innerTxns.instructions,
      ]
    } 
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: recentBlockhash || (await (connection2.getLatestBlockhash())).blockhash,
      instructions: ins,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer, ...innerTxns.signers]);
    
    const sig = await sendTransaction(transaction, skipPreflight, config.maxAttempts, true, recentBlockhash)
    return sig;
    } catch(e) {
      console.log(e)
    }
}

export const buy = async (payer: Keypair, buyConfig: TradeConfig) => {
    let {
    amt_in,
    poolKeys,
    slippage,
    recentblockHash, 
  } = buyConfig;
  try{
    poolKeys = poolKeys!
    const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint
    const taIn = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey)
    const taOut = getAssociatedTokenAddressSync(token, payer.publicKey)
    const amtIn = Number(amt_in) * (10**poolKeys.quoteDecimals)
    let minAmountOut = new BN(1);
    if(slippage) {
        const updatedPoolInfo = await getPoolInfo(poolKeys)
        minAmountOut = Liquidity.computeAmountOut({
          poolKeys: poolKeys,
          poolInfo: updatedPoolInfo!, 
          amountIn: new CurrencyAmount(new Currency(poolKeys.quoteDecimals), amtIn),
          currencyOut: new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals),
          slippage: new Percent(slippage)
      }).minAmountOut.raw
    }
    console.log(`buying ${token}`)
    return raydiumSwap(buyConfig, payer, amtIn, taIn, taOut, minAmountOut, recentblockHash)
  }
  catch(e) {
    console.log(e);
    return;
  }
} 

export const sell = async (payer: Keypair, buyConfig: TradeConfig) => {
  let {
  amt_in,
  poolKeys,
  slippage,
  recentblockHash, 
} = buyConfig;
try{
  poolKeys = poolKeys!
  const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint
  const taIn = getAssociatedTokenAddressSync(token, payer.publicKey)
  const taOut = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey)
  let minAmountOut = new BN(1);
  if(slippage) {
      const updatedPoolInfo = await getPoolInfo(poolKeys)
      minAmountOut = Liquidity.computeAmountOut({
        poolKeys: poolKeys,
        poolInfo: updatedPoolInfo!, 
        amountIn: new CurrencyAmount(new Currency(poolKeys.quoteDecimals), amt_in, true),
        currencyOut: new Token(TOKEN_PROGRAM_ID, poolKeys.quoteMint, poolKeys.quoteDecimals),
        slippage: new Percent(slippage)
    }).minAmountOut.raw
  }
  console.log(`selling ${token}`)
  return raydiumSwap(buyConfig, payer, amt_in, taIn, taOut, minAmountOut, recentblockHash, false)
}
catch(e) {
  console.log(e);
  return;
}
} 

export const swapFromCa = async (addr: string, config: TradeConfig) => {
  try{
    let {
      maxAttempts = 1, 
      fee = 0,
    } = config;
    const payerKey = config.payerKey!
    const poolKeys = await getPoolKeys(addr);
    config.poolKeys = poolKeys;
    if(!config.maxFee) {
      config.maxFee =650_000
    }
    if(fee==0) {
      const m = await getFeeForPoolkeys(poolKeys);
      config.fee =  Math.min(m.avg, config.maxFee)
    }
    let curr_attempts = 0;    
    const clear = setInterval(async ()=>{
      try{
        let sig;
        if(config.side) {
          config.slippage = config.slippage || 20
          const solBal = await connection2.getBalance(payerKey.publicKey)
          if(solBal<(2039280 + 2039280/2)) {
            if(config.logs) {
              console.log(`Not buying ${addr} bc no sol lol`)
            }
            clearInterval(clear)

          }
          sig = await buy(payerKey, config)
        } else {
          sig = await sell(payerKey, config)
        }
          
        if(sig) {
          curr_attempts+=1;
          if(curr_attempts>=maxAttempts) {
            clearInterval(clear)
          }
        }
        }
        catch(e) {
          console.log(e)
          if(curr_attempts>=maxAttempts*2) {
            clearInterval(clear)
          }
        }
    },5_000)
  } catch(e) {
    console.log(e)
  }
}

export async function filterMatch(poolKeys: LiquidityPoolKeysV4, config: TradeConfig) {
  const filterCheckInterval = config.filterCheckInterval || 0;
  const filterCheckDuration = config.filterCheckDuration || 0;
  const poolFilters = config.poolFilters;
  if (!poolFilters || config.filterCheckInterval === 0 || config.filterCheckDuration === 0) {
    return true;
  }

  const timesToCheck = filterCheckDuration / filterCheckInterval;
  let timesChecked = 0;
  let matchCount = 0;

  do {
    try {
      const shouldBuy = await poolFilters.execute(poolKeys);
      if(config.logs) {
        console.log(`Executed filter check for ${poolKeys.baseMint.toString()} result=${shouldBuy}, check num ${timesChecked}/${timesToCheck}`)
      }
      if (shouldBuy) {
        matchCount++;

        if ( (config.consecutiveMatchCount || 1) <= matchCount) {
          return true;
        }
      } else {
        matchCount = 0;
      }

      await sleep(config.filterCheckInterval);
    } finally {
      timesChecked++;
    }
  } while (timesChecked < timesToCheck);

  return false;
}

// export async function getPositionsAndSell(payer: string, config: TradeConfig) {
//   try {
//     const payerKey = Keypair.fromSecretKey(bs58.decode(payer))
//     const tokenAccounts = await getTokenAccountsByOwner(payerKey.publicKey)
//     tokenAccounts.forEach(async ta => {
//       const tokenAddr = ta.accountInfo.mint.toString()
//       if(tokenAddr.endsWith('pump')) {  
//         try{    
//           const poolKeys = await getPoolKeys(tokenAddr)
//           const decimals = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteDecimals : poolKeys.baseDecimals
//           if(!ta.accountInfo.amount || ta.accountInfo.amount.eq(new BN(0))) { 
//             const ins = [createCloseAccountInstruction(ta.pubkey, payerKey.publicKey, payerKey.publicKey)]
//             const messageV0 = new TransactionMessage({
//               payerKey: payerKey.publicKey,
//               recentBlockhash: (await (connection2.getLatestBlockhash())).blockhash,
//               instructions: ins,
//             }).compileToV0Message();
//             const transaction = new VersionedTransaction(messageV0);
//             transaction.sign([payerKey]);
//             await connection2.sendTransaction(
//               transaction,
//               {
//                 skipPreflight: true,
//                 maxRetries: 1,
//               }
//             );
//             mintDataCache.delete(tokenAddr)
//             return;
//           }
//           const bal = ta.accountInfo.amount.div(new BN(10 ** decimals)).toNumber()
//           const price = await getTokenPrice(tokenAddr);
//           const posVal = bal * price;
//           const solPrice = await getSolPrice();
//           const posValSol = posVal /solPrice;
//           //const m = await getFeeForPoolkeys(poolKeys);
//           //const fee =  Math.min(m.avg * 2, m.high * 1.5)
//           if(posValSol >= Number(config.amt_in) * 2 || posValSol <= Number(config.amt_in) * .2) {
//              sell(payerKey, {side: false, amt_in: ta.accountInfo.amount, poolKeys:poolKeys, fee:50_000})   
//           }  if(posValSol >= Number(config.amt_in) * 1.5) {
//              sell(payerKey, {side: false, amt_in: ta.accountInfo.amount.div(new BN(3)), poolKeys:poolKeys, fee:50_000})    
//           }  
//           let curr = mintDataCache.get(tokenAddr)
//           if(curr) {
//             curr.lastPosVal = posValSol
//             mintDataCache.set(tokenAddr,curr)
//           }
        
          
//         } catch(e) {
//           console.log(e)
//         }
//       }
      
//     });
// } catch(e) {
//     console.log(e)
// }
// }

const closeListeners = (quoteListener, tokenListener, taListener) => {
  // Array of callbacks to close each listener
  const closeCallbacks: Array<Function> = [];

  // Adding callbacks to the array
  closeCallbacks.push(() => connection.removeAccountChangeListener(quoteListener));
  closeCallbacks.push(() => connection.removeAccountChangeListener(tokenListener));
  closeCallbacks.push(() => connection.removeAccountChangeListener(taListener));

  // Returning the array of callbacks
  return closeCallbacks;
};

function removeListeners(tokenAddr: string) {
  const tokenData = mintDataCache.get(tokenAddr)
  if(tokenData&& tokenData.priceCache && tokenData.priceCache.closeAccountListeners) {
    tokenData.priceCache.closeAccountListeners.forEach(
      (func) => {
        func();
      }
    )
  }
}

export async function getPositionsAndSell(config: TradeConfig) {
  for (const mint of mintDataCache.keys()) {
    processSellStrat(config, mint)
  }
}

export async function initListeners(config: TradeConfig) {
  const tokenAccounts = await getTokenAccountsByOwner(config.payerKey!.publicKey);
  for (const ta of tokenAccounts) {
    const tokenAddr = ta.accountInfo.mint.toString();
    if (ta.accountInfo.amount.eq(new BN(0))) {
      connection2.getLatestBlockhash().then(
          (blockhash)=> {
            try{
            const ins = [createCloseAccountInstruction(ta.pubkey, config.payerKey!.publicKey, config.payerKey!.publicKey)];
            const messageV0 = new TransactionMessage({
              payerKey: config.payerKey!.publicKey,
              recentBlockhash: blockhash.blockhash,
              instructions: ins,
            }).compileToV0Message();
            const transaction = new VersionedTransaction(messageV0);
            transaction.sign([config.payerKey!]);
            sendTransaction(transaction, false, 3, true, blockhash)
          }catch {}
          }, 
        )
        continue;
      }
      if (tokenAddr.endsWith('pump')) {
        await startListener(tokenAddr, config, ta)
      }
  }
}
async function startListener(tokenAddr, config, ta) {
  try{
  // getPoolKeys(tokenAddr).then(
  //   (poolKeys)=> {
  //     startVaultListeners(poolKeys, config, ta.accountInfo)
  //     if(config.logs) {
  //       console.log(`init listener with ${tokenAddr}`)
  //     }
  //     processSellStrat(config, tokenAddr)
  //   }, 
  //   (err)=> {
  //     console.log(err)
  //   }
  // )
    const poolKeys = await getPoolKeys(tokenAddr)
    startVaultListeners(poolKeys, config, ta.accountInfo)
    if(config.logs) {
      console.log(`init listener with ${tokenAddr}`)
    }
    processSellStrat(config, tokenAddr)
  } catch {
    startListener(tokenAddr, config, ta)
  }
}

// Function to manage positions with trailing stop-loss
// export async function getPositionsAndSell(payer: string, config: TradeConfig) {
//   try {
//     const payerKey = Keypair.fromSecretKey(bs58.decode(payer));
//     const tokenAccounts = await getTokenAccountsByOwner(payerKey.publicKey);
//     for (const ta of tokenAccounts) {
//       const tokenAddr = ta.accountInfo.mint.toString();
//       if (tokenAddr.endsWith('pump')) {
//         try {
//           const poolKeys = await getPoolKeys(tokenAddr);
//           const decimals = poolKeys.baseMint.toString() === NATIVE_MINT.toString() ? poolKeys.quoteDecimals : poolKeys.baseDecimals;
//           const cache = mintDataCache.get(tokenAddr)
//           if (!ta.accountInfo.amount || ta.accountInfo.amount.eq(new BN(0))) {
//             const ins = [createCloseAccountInstruction(ta.pubkey, payerKey.publicKey, payerKey.publicKey)];
//             const messageV0 = new TransactionMessage({
//               payerKey: payerKey.publicKey,
//               recentBlockhash: (await connection2.getLatestBlockhash()).blockhash,
//               instructions: ins,
//             }).compileToV0Message();
//             const transaction = new VersionedTransaction(messageV0);
//             transaction.sign([payerKey]);
//             await connection2.sendTransaction(transaction, { skipPreflight: false, maxRetries: 1 });
//             removeListeners(tokenAddr);
//             mintDataCache.delete(tokenAddr);
//             continue;
//           }
//           // if(cache && (!cache.priceCache || cache.priceCache.closeAccountListeners?.length==0)) {
//           //   startVaultListeners(poolKeys)
//           // }

//           const bal = ta.accountInfo.amount.div(new BN(10 ** decimals)).toNumber();
//           let posValSol;
//           const price = await getCachedTokenPrice(tokenAddr, config, poolKeys);
//           if (price) {
//             posValSol = bal * price;
//           } else {
//             const price = await getTokenPrice(tokenAddr);
//             const posVal = bal * price;
//             const solPrice = await getSolPrice();
//             posValSol = posVal / solPrice;
//           }

//           // Retrieve or initialize the trailing stop info for this token
//           let trailingStopInfo;
//           if(config.trailingStopPercentage) {
//             if (cache && 'trailingStopInfo' in cache!) {
//               trailingStopInfo = cache!.trailingStopInfo;
//             } else {
//               trailingStopInfo = { peakPrice: posValSol, trailingStopPrice: posValSol * (1 - (config.trailingStopPercentage / 100)) };
//             }

//             // Update the peak price and trailing stop price
//             if (posValSol > trailingStopInfo.peakPrice) {
//               trailingStopInfo.peakPrice = posValSol;
//               trailingStopInfo.trailingStopPrice = trailingStopInfo.peakPrice * (1 - (config.trailingStopPercentage / 100));
//             }
//           }

//           // Check if the current position value in SOL has hit any sell levels
//           if(config.sellLevels) {
//             for (const { level, percentage } of config.sellLevels) {
//               //@ts-ignore
//               if (posValSol >= config.amt_in * level && !trailingStopInfo[`soldAt${level}x`]) {
//                 // Sell a percentage of the position
//                 const sellAmount = ta.accountInfo.amount.mul(new BN(percentage)).div(new BN(100));
//                 await sell(payerKey, { side: false, amt_in: sellAmount, poolKeys: poolKeys, fee: 50_000 });

//                 // Mark this level as sold
//                 trailingStopInfo[`soldAt${level}x`] = true;

//                 // Update the cache with the new trailing stop info
//                 let curr = mintDataCache.get(tokenAddr);
//                 if (curr) {
//                   curr.trailingStopInfo = trailingStopInfo;
//                   mintDataCache.set(tokenAddr, curr);
//                 }
//               }
//             }
//           }

//           // Check if the current position value in SOL has hit the trailing stop price
//           //@ts-ignore
//           if (trailingStopInfo && (posValSol <= trailingStopInfo.trailingStopPrice)) {
//             // Full sell triggered by trailing stop
//             await sell(payerKey, { side: false, amt_in: ta.accountInfo.amount, poolKeys: poolKeys, fee: 50_000 });
//             // Remove from cache since the position is closed
//             mintDataCache.delete(tokenAddr);
//           } else {
//             // Update the cache with the new trailing stop info
//             let curr = mintDataCache.get(tokenAddr);
//             if (curr) {
//               curr.trailingStopInfo = trailingStopInfo;
//               mintDataCache.set(tokenAddr, curr);
//             }
//           }

//         } catch (e) {
//           console.log(e);
//         }
//       }
//     }
//   } catch (e) {
//     console.log(e);
//   }
// }
