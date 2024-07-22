import { Connection, PublicKey } from "@solana/web3.js";
import https from 'node:https'

const keepaliveAgent = new https.Agent({
  timeout: 4000,
  maxSockets: 2048,
});

// Mainnet
export const OPENBOOK_PROGRAM_ID = new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX');
export const RAYDIUM_POOL_V4_PROGRAM_ID = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=";
const HELIUS_RPC_URL_2 = 'https://mainnet.helius-rpc.com/?api-key='
export const connection = new Connection(HELIUS_RPC_URL, {
  disableRetryOnRateLimit: false,
  httpAgent: keepaliveAgent,
  wsEndpoint: "wss://mainnet.helius-rpc.com/?api-key="
});

export const connection2 = new Connection(HELIUS_RPC_URL_2, {
  disableRetryOnRateLimit: false,
  httpAgent: keepaliveAgent,
  wsEndpoint: "wss://mainnet.helius-rpc.com/?api-key="
});

// Testnet
// export const OPENBOOK_PROGRAM_ID = new PublicKey('EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj');
// export const RAYDIUM_POOL_V4_PROGRAM_ID = new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8");
// const HELIUS_RPC_URL = "https://devnet.helius-rpc.com/?api-key="



