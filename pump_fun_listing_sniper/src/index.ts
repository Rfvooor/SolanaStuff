import { Keypair, Logs, PublicKey } from '@solana/web3.js';
import { filterMatch, getPoolKeys, getPositionsAndSell, initListeners, swapFromCa } from './swap.js';
import { RAYDIUM_POOL_V4_PROGRAM_ID, connection, connection2 } from './constants.js';
import { PoolFilters } from './filters.js';
import bs58 from "bs58";
const payer = '' 

const PF_MIGRATE = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg'
// const config = {
//   side: true,
//   amt_in: .001, 
//   slippage: 20,
//   maxAttempts: 1,
//   sellInterval: 10_000,
//   filterCheckInterval: 10_000,
//   filterCheckDuration: 60_000*15,
//   poolFilters: new PoolFilters(connection, {
//     minMarketCap: 20_000,
//     maxMarketCap: 30_000,
//     minHolderCount: 0,
//     minVolume: 0,
//     minBuys: 0,
//     dexInterval: 'm5',
//   })
// }

// const config2 = {
//   payerKey: Keypair.fromSecretKey(bs58.decode(payer)),
//   side: true,
//   amt_in: .001, 
//   slippage: 33,
//   maxAttempts: 2,
//   sellInterval: 2_000,
//   filterCheckInterval: 6_000,
//   filterCheckDuration: 60_000*5,
//   trailingStopPercentage: 40,
//   sellLevels: [{level: 2, percentage: 50}, {level: 5, percentage: 20}, {level: 8, percentage: 20}],
//   price_cache_ttl: 2,
//   poolFilters: new PoolFilters(connection, {
//     minMarketCap: 17_000,
//     maxMarketCap: 25_000,
//     minHolderCount: 0,
//     minVolume: 0,
//     minBuys: 0,
//     dexInterval: 'm5',
//   }),
//   logs: true,
//   stopLoss: 60,
// }

// const config = {
//   payerKey: Keypair.fromSecretKey(bs58.decode(payer)),
//   side: true,
//   amt_in: .0001, 
//   slippage: 33,
//   maxAttempts: 1,
//   sellInterval: 3_000,
//   filterCheckInterval: 1_000,
//   filterCheckDuration: 60_000,
//   trailingStopPercentage: 40,
//   sellLevels: [{level: 1.5, percentage: 10},{level: 2.5, percentage: 10}, {level: 4, percentage: 10},{level: 7, percentage: 15}, {level: 9, percentage: 10}],
//   price_cache_ttl: 2,
//   poolFilters: new PoolFilters(connection2, {
//     minMarketCap: 0,
//     maxMarketCap: 0,
//     minHolderCount: 70,
//     minVolume: 0,
//     minBuys: 0,
//     dexInterval: 'm5',
//   }),
//   logs: false,
//   stopLoss: 60,
// }

const config = {
  payerKey: Keypair.fromSecretKey(bs58.decode(payer)),
  side: true,
  amt_in: .0001, 
  slippage: 33,
  maxAttempts: 1,
  sellInterval: 3_000,
  filterCheckInterval: 1_000,
  filterCheckDuration: 60_000,
  trailingStopPercentage: 10,
  sellLevels: [{level: 1.1, percentage: 20},{level: 1.2, percentage: 20}, {level: 1.3, percentage: 20},{level: 1.4, percentage: 20}, {level: 1.5, percentage: 20}],
  price_cache_ttl: 2,
  poolFilters: new PoolFilters(connection2, {
    minMarketCap: 0,
    maxMarketCap: 0,
    minHolderCount: 70,
    minVolume: 0,
    minBuys: 0,
    dexInterval: 'm5',
  }),
  logs: false,
  stopLoss: 10,
  maxFee: 100_000
}
connection.onLogs(
  new PublicKey(PF_MIGRATE),
  async (txLogs: Logs) => {
    try {
      const txn = await connection.getParsedTransaction(txLogs.signature, {commitment:"confirmed", maxSupportedTransactionVersion: 1});
      const keys = txn?.transaction.message.accountKeys.map(
        (v) => {
          return v.pubkey.toString()
        }
      )
      if(keys && keys.includes(RAYDIUM_POOL_V4_PROGRAM_ID.toString())) {
        const tokenAddr = txn?.transaction.message.accountKeys.map(e => e.pubkey.toString()).find(str => /pump$/.test(str));
        if(tokenAddr && (await filterMatch(await getPoolKeys(tokenAddr!), config))) {// || await filterMatch(await getPoolKeys(tokenAddr!), config2))) {
          swapFromCa(tokenAddr!, config )
        }
      }
    } catch (err) { 
      console.log(err)
    }
  },
  "confirmed",
);

initListeners(config)
setInterval(
  ()=> {
    getPositionsAndSell(config)
  },config.sellInterval
)