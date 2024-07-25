import pkg, {LiquidityPoolKeysV4, MARKET_STATE_LAYOUT_V2, MARKET_STATE_LAYOUT_V3} from '@raydium-io/raydium-sdk';
const { Liquidity } =pkg;
import { unpackMint } from '@solana/spl-token';
import { Commitment, PublicKey } from '@solana/web3.js';
import {getRpcConn, OPENBOOK_PROGRAM_ID, RAYDIUM_POOL_V4_PROGRAM_ID} from './constants.js'
import fs from 'fs';

export const settingsFile = './settings.json';
export interface Settings {
    rpcUrl: string;
    numHolders: number;
    whaleThreshold: number;
}

export interface MintData {
  poolKeys?: LiquidityPoolKeysV4,
}

const connection = getRpcConn()
const mintDataCache = new Map<string, MintData>();

export function getSettings() {
  let settings: Settings = { rpcUrl: '', numHolders: 10, whaleThreshold: 100000 };
  if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  }
  return settings
}

export function saveSettings(settings) {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}


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
    curr = {poolKeys: poolKeys}
  }
  mintDataCache.set(tokenAddr.toString(),curr)
  return poolKeys;
}