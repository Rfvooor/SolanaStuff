import { Commitment, ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

//import { MARKET_STATE_LAYOUT_V3, MARKET_STATE_LAYOUT_V2, LiquidityPoolKeysV4, Liquidity, Percent, Token,TokenAmount } from '@raydium-io/raydium-sdk';
import pkg, { BigNumberish, LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
const { MARKET_STATE_LAYOUT_V3, MARKET_STATE_LAYOUT_V2, Liquidity, Percent, Token, TokenAmount } = pkg;
import {NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, unpackMint } from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';
import { OPENBOOK_PROGRAM_ID, RAYDIUM_POOL_V4_PROGRAM_ID, getRpcConn } from "./constants.js";
import { loadSettingsFile } from './settings.js';
export const mintDataCache = new Map<String, MintData>();

export interface MintData {
  poolKeys?: LiquidityPoolKeysV4,
}



export async function getSerumMarketForToken(
  tokenMint: String,
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
  const rpc_conn = getRpcConn()
  const account = await rpc_conn.getProgramAccounts(OPENBOOK_PROGRAM_ID, {
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
  const account = await rpc_conn.getProgramAccounts(OPENBOOK_PROGRAM_ID, {
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
  if(mintDataCache.has(addr)) {
    return mintDataCache.get(addr)?.poolKeys!
  }
    const rpc_conn = getRpcConn()
    const market = await getSerumMarketForToken(addr, "confirmed");
    const tokenAddr = new PublicKey(addr);
    const tokenAccountInfo = await rpc_conn.getAccountInfo(tokenAddr);
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
    return { ...poolInfo, ...marketKeys };
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
  const rpc_conn = getRpcConn()
  const fees = await rpc_conn.getRecentPrioritizationFees({lockedWritableAccounts: [poolkeys.id, poolkeys.openOrders, poolkeys.targetOrders, poolkeys.marketId, poolkeys.quoteVault, poolkeys.baseVault]})
  return calculateMetrics(fees)
}

export const raydiumSwap = async (poolKeys: LiquidityPoolKeysV4, payer: Keypair, rawAmtIn: string, slippage: number|null, side: boolean, close?: boolean, fee=200_000) => {
  try {

    let innerTxns;
    const rpc_conn = getRpcConn()
    let quote = getAssociatedTokenAddressSync(poolKeys.baseMint, payer.publicKey)
    let ata = getAssociatedTokenAddressSync(poolKeys.quoteMint, payer.publicKey)
    let minAmountOut: BigNumberish = 1
    let amtIn = new BN(rawAmtIn)                                                                                                                                                        
    if(side) {
      quote = getAssociatedTokenAddressSync(poolKeys.quoteMint, payer.publicKey)
      ata = getAssociatedTokenAddressSync(poolKeys.baseMint, payer.publicKey)
    } 
    //let token = new Token(TOKEN_PROGRAM_ID ,NATIVE_MINT, 9);
    let token = Token.WSOL
    //let tokenAmt = new TokenAmount(Token.WSOL, amtIn, true);
    if(poolKeys.quoteMint.toString()!=NATIVE_MINT.toString()) {
      if(slippage) {
        const updatedPoolInfo = await Liquidity.fetchInfo({connection: rpc_conn, poolKeys: poolKeys})
        minAmountOut = Liquidity.computeAmountOut({
          poolKeys: poolKeys,
          poolInfo: updatedPoolInfo, 
          // @ts-ignore comment
          amountIn: amtIn,
          currencyOut: token,
          slippage: new Percent(slippage)
      }).minAmountOut.raw
      }
      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: poolKeys,
          userKeys: {
            // @ts-ignore comment
            tokenAccountIn: ata,
            // @ts-ignore comment
            tokenAccountOut: quote,
            owner: payer.publicKey,
          },
          // @ts-ignore comment
          amountIn: amtIn,
          minAmountOut: minAmountOut,
        },
        poolKeys.version,
      );
      innerTxns = innerTransaction;
    } else {
      if(slippage) {
        const updatedPoolInfo = await Liquidity.fetchInfo({connection: rpc_conn, poolKeys: poolKeys})
        minAmountOut = Liquidity.computeAmountOut({
          poolKeys: poolKeys,
          poolInfo: updatedPoolInfo, 
          // @ts-ignore comment
          amountIn: amtIn,
          currencyOut: token,
          slippage: new Percent(slippage) 
      }).minAmountOut.raw
      }
      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: poolKeys,
          userKeys: {
            // @ts-ignore comment
            tokenAccountIn: quote,
            // @ts-ignore comment
            tokenAccountOut: ata,
            owner: payer.publicKey,
          },
          // @ts-ignore comment
          amountIn: amtIn,
          minAmountOut: minAmountOut,
        },
        poolKeys.version,
      );
      innerTxns = innerTransaction;
    }
    let ins;
    ins = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000}),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(fee) }),
      ...innerTxns.instructions,
    ]
    if(side) {
      ins = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000}),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(fee) }),
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, payer.publicKey, poolKeys.baseMint),
        ...innerTxns.instructions,
      ]
    }
    if(close) {
      if(poolKeys.baseMint.toString()==NATIVE_MINT.toString()) 
        ins.push(createCloseAccountInstruction(getAssociatedTokenAddressSync(poolKeys.quoteMint, payer.publicKey), payer.publicKey, payer.publicKey))
      else 
        ins.push(createCloseAccountInstruction(getAssociatedTokenAddressSync(poolKeys.baseMint, payer.publicKey), payer.publicKey, payer.publicKey))
    }
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: (await (rpc_conn.getLatestBlockhash())).blockhash,
      instructions: ins,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer, ...innerTxns.signers]);
    
    const sig = await rpc_conn.sendTransaction(
      transaction,
      {
        skipPreflight: false,
        maxRetries: 1,
      }
    );
    return sig;
    } catch(e) {
      console.log(e)
    }
}
export const swapFromCa = async (payer, addr: string, amt_in, side, attempts=3, fee=0, slippage=0) => {
  try{
    // const jupQuote = await getJupQuote(addr, side, amt_in, 0 )
    const poolKeys = await getPoolKeys(addr)
    const rpc_conn = getRpcConn()
    if(fee==0) {
      const m = await getFeeForPoolkeys(poolKeys);
      fee =  Math.min(m.avg * 2, m.high * 1.5)
    }
    let curr_attempts = 0;
    const clear = setInterval(async ()=>{
       try{
    //     if(jupQuote) {
    //       const sig = await jupSwap(payer2, addr, amt_in, slippage, side)
    //       if(sig) {
    //         attempts+=1;
    //         if(attempts>0) {
    //           //clearInterval(clear)
    //         }
    //         rpc_conn.onSignature(
    //           sig, (sigResult)=> {
    //             if (!sigResult.err) {
    //               console.log(`buy sig: ${sig}`);
    //               const b = TRADES.get(addr)
    //               if(b) {
    //                 TRADES.set(addr, {init_sold:b.init_sold, bought:b.bought+1, init_buy:b.init_buy, prev_value:b.prev_value})
    //               } else {
    //                 TRADES.set(addr, {init_sold:false, bought:1})
    //               }
    //               clearInterval(clear);
    //             }
    //           }, "processed"
    //         )

    //       }
    //     } else {
          const sig = await raydiumSwap(poolKeys, Keypair.fromSecretKey(bs58.decode(payer)), amt_in, slippage, side , false,fee--)
            if(sig) {
              curr_attempts+=1;
              if(curr_attempts>attempts) {
                clearInterval(clear)
              }
              rpc_conn.onSignature(
                sig, (sigResult)=> {
                  if (!sigResult.err) {
                    console.log(`Buy sig: ${sig}`);
                    clearInterval(clear);
                  }
                }, "processed"
              )
            }
        //}
       }
        catch(e) {
          console.log(e)
        }
      },3_000)
  } catch(e) {
    console.log(e)
  }
}

export const swap = (message) => {
  const dexscreenerPattern = /https:\/\/dexscreener\.com\/solana\/(\w+)/;
  const dextoolsPattern = /https:\/\/(?:www\.)?dextools\.io\/app\/solana\/pair-explorer\/(\w+)/;
  const birdeyePattern = /https:\/\/birdeye\.so\/token\/(\w+)\?chain=solana/;
  const caPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
  const settings = loadSettingsFile()
  let matched = false;

  // Dexscreener match
  let dexUrlMatch = dexscreenerPattern.exec(message);
  if (dexUrlMatch && !matched) {
    const addr = dexUrlMatch[1];
    getPoolKeys(addr);
    swapFromCa(settings.secretkey, addr, (settings.snipeAmt * LAMPORTS_PER_SOL).toString(), true, 0, settings.slippage);
    matched = true;
  }

  // DexTools match
  let dextoolsUrlMatch = dextoolsPattern.exec(message);
  if (dextoolsUrlMatch && !matched) {
    const addr = dextoolsUrlMatch[1];
    getPoolKeys(addr);
    swapFromCa(settings.secretkey, addr, (settings.snipeAmt * LAMPORTS_PER_SOL).toString(), true, 0, settings.slippage);
    matched = true;
  }

  // BirdEye match
  let birdeyeUrlMatch = birdeyePattern.exec(message);
  if (birdeyeUrlMatch && !matched) {
    const addr = birdeyeUrlMatch[1];
    getPoolKeys(addr);
    swapFromCa(settings.secretkey, addr, (settings.snipeAmt * LAMPORTS_PER_SOL).toString(), true, 0, settings.slippage);
    matched = true;
  }

  // Contract address match
  let caMatch = caPattern.exec(message);
  if (caMatch && !matched) {
    const addr = caMatch[0];
    getPoolKeys(addr);
    swapFromCa(settings.secretkey, addr, (settings.snipeAmt * LAMPORTS_PER_SOL).toString(), true, 0, settings.slippage);
    matched = true;
  }

  return matched;
};
