import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getPoolKeys, getSettings, saveSettings, Settings } from './utils.js';
import { getRpcConn } from './constants.js';
import { SPL_ACCOUNT_LAYOUT } from '@raydium-io/raydium-sdk';

let settings: Settings = getSettings()
let connection = getRpcConn()

function updateConnection() {
  connection = getRpcConn()
}

async function getTokenAccountOwner(tokenAccountPublicKey: PublicKey) {
  const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccountPublicKey);
  if (tokenAccountInfo.value !== null) {
    const data = tokenAccountInfo.value.data;
    if ('parsed' in data && data.parsed.info.owner) {
      return new PublicKey(data.parsed.info.owner);
    } else {
      throw new Error('Failed to parse token account data.');
    }
  } else {
    throw new Error('Token account not found.');
  }
}

async function getLargestHolders(tokenAddress: string, numHolders: number) {
    const token = new PublicKey(tokenAddress);
    const tokenAccounts = await connection.getTokenLargestAccounts(token);
    return tokenAccounts.value.map(
      async (value) => {
        const poolKeys = await getPoolKeys(tokenAddress)
        if(value.address.toString() == poolKeys.baseVault.toString() || value.address.toString() == poolKeys.quoteVault.toString()) {
          return;
        }
        const holder = await getTokenAccountOwner(value.address)
        return {...value, pubkey: holder, tokenAccounts: await getTokenAccounts(holder)}
      }
    ).slice(0, numHolders)
}

async function getTokenAccounts(holder: PublicKey) {
    const accounts = await connection.getParsedTokenAccountsByOwner(holder, { programId: TOKEN_PROGRAM_ID });
    return accounts.value;
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

async function getSolBalance(holder: string) {
    const balance = await connection.getBalance(new PublicKey(holder));
    return balance / LAMPORTS_PER_SOL;
}

async function fetchTokenData(tokenAddress: string) {
    const holders = await getLargestHolders(tokenAddress, settings.numHolders);
    for (const holder of holders) {
      const details = await holder
      if(!details) {
        continue;
      }
      const holderAddress = details.pubkey.toString();
      const tokenAccounts = details.tokenAccounts;
      let totalValue = 0;
      let holdings: { token: string, amount: number, value: number }[] = [];

      for (const account of tokenAccounts) {
          const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
          const poolKeys = await getPoolKeys(account.account.data.parsed.info.mint);
          const price = await getTokenPriceRaydium(poolKeys);
          const value = amount * price!;
          totalValue += value;
          holdings.push({ token: account.pubkey.toString(), amount, value });
      }
      const solBalance = await getSolBalance(holderAddress);
      totalValue += solBalance;

      const notableHoldings = holdings.sort((a, b) => b.value - a.value).slice(0, 3);

      console.log(`Holder: ${holderAddress}`);
      console.log(`dexs link for token: https://dexscreener.com/solana/${tokenAddress}?maker=${holderAddress}`)
      console.log(`Total Value: $${totalValue.toFixed(2)}`);
      console.log(`Is Whale: ${totalValue >= settings.whaleThreshold ? chalk.green('Yes') : chalk.red('No')}`);
      console.log('Notable Holdings:');
      notableHoldings.forEach(holding => {
          console.log(`  - ${holding.token}: ${holding.amount} ($${holding.value.toFixed(2)})`);
          console.log(`dexs link: https://dexscreener.com/solana/${holding.token}?maker=${holderAddress}`)
      });
      console.log(`SOL Balance: ${solBalance.toFixed(5)} SOL ()`);
      console.log('-----------------------------');
    } 
}

async function mainMenu() {
    console.log('\n--- Solana Token Whale Tracker ---\n');

    const menuChoices = [
        'Change RPC Link',
        'Change Number of Top Holders',
        'Change Whale Threshold',
        'Enter Contract Address',
        'Exit'
    ];

    const { action } = await inquirer.prompt({
        name: 'action',
        type: 'list',
        //@ts-ignore
        message: 'Select an action:',
        choices: menuChoices
    });

    switch (action) {
      case 'Change RPC Link':
          const { rpc } = await inquirer.prompt({
              name: 'rpc',
              type: 'input',
              message: {message:'Enter the RPC link:'}
          });
          settings.rpcUrl = rpc;
          saveSettings(settings);
          updateConnection();
          console.log('RPC link updated.');
          break;

      case 'Change Number of Top Holders':
          const { numHolders } = await inquirer.prompt({
              name: 'numHolders',
              type: 'number',
              //@ts-ignore
              message:'Enter the number of top holders to fetch (max 20):'
          });
          settings.numHolders = numHolders;
          if(numHolders>20) {
            settings.numHolders = 20 
          }
          saveSettings(settings);
          console.log('Number of top holders updated.');
          break;

      case 'Change Whale Threshold':
          const { whaleThreshold } = await inquirer.prompt({
              name: 'whaleThreshold',
              type: 'number',
              //@ts-ignore
              message:'Enter the USD value threshold to be considered a whale:'
          });
          settings.whaleThreshold = whaleThreshold;
          saveSettings(settings);
          console.log('Whale threshold updated.');
          break;

      case 'Enter Contract Address':
          const { contractAddress } = await inquirer.prompt({
              name: 'contractAddress',
              type: 'input',
              //@ts-ignore
              message: 'Enter the contract address:'
          });
          await fetchTokenData(contractAddress);
          break;

      case 'Exit':
          console.log('Goodbye!');
          process.exit(0);
    }

    mainMenu();
}

mainMenu();
