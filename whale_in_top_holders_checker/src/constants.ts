import { Connection, PublicKey } from "@solana/web3.js";
import https from 'node:https'
import {getSettings} from './utils.js'
import { clusterApiUrl } from "@solana/web3.js";

const keepaliveAgent = new https.Agent({
  timeout: 4000,
  maxSockets: 2048,
});

// Mainnet
export const OPENBOOK_PROGRAM_ID = new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX');
export const RAYDIUM_POOL_V4_PROGRAM_ID = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const mainnetBetaRpc = clusterApiUrl('mainnet-beta')
// Testnet
// export const OPENBOOK_PROGRAM_ID = new PublicKey('EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj');
// export const RAYDIUM_POOL_V4_PROGRAM_ID = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8");
// const HELIUS_RPC_URL = ""



export function getRpcConn() {
  const settings = getSettings()
  const url = settings.rpcUrl || mainnetBetaRpc
  return new Connection(url, {
    disableRetryOnRateLimit: false,
    httpAgent: keepaliveAgent,
   // wsEndpoint: HELIUS_WSS_RPC_URL
  });
}
