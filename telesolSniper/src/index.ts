import { loadSettingsFile, saveSettings, printSettings } from './settings.js';
import { performTelegramLogin, snipeMessage, tgListener } from './telegram.js';
import readlineSync from 'readline-sync';
import { NewMessage} from "telegram/events/index.js"
import readline from 'readline';
import { swap } from './swap.js';

let isSniperRunning = false;
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
export async function askQuestionAsync(question) {
  return new Promise((resolve) => { 
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}
export function askQuestion(prompt) {
  const answer =  readlineSync.question(`${prompt}: `);
  return answer;
}

export function askPassword() {
  const prompt = 'Please enter your password: '
  const password = readlineSync.question(`${prompt}: `, {
    hideEchoBack: true // Mask user input
  });
  return password;
}

async function startCLI() {
  console.log('welcome to telesol sniper.');
  const client = await performTelegramLogin();
  if(client) {
    showMenu(client)
  }
}

async function toggleSniper(client) {
  if (isSniperRunning) {
    // Stop sniper process
    console.log('Stopping sniper process...');
    client.removeEventHandler(snipeMessage, new NewMessage({}));
    isSniperRunning = false;
    console.log('Sniper process stopped.');
  } else {
    console.log('Starting sniper process...');
    isSniperRunning = true;
    tgListener(client); 
    console.log('Sniper process started.');
  }
  showMenu(client);
}

export async function showMenu(client) {
  const settings = loadSettingsFile()
  console.log('\nMenu:');
  console.log('1. Enter alert channels/usernames');
  console.log('2. View/edit Settings');
  console.log('3. Show Private Key');
  console.log('4. Toggle Sniper');
  console.log('5. Exit');
  console.log("Sniper uses WSOL, please send WSOL > snipe amount and SOL for fees")
  rl.question(
    "Select an option: ", async (option) => {
      switch (option.trim()) {
        case '1':
          const channels = await askQuestionAsync('Enter a comma seperated list of channels/usernames to snipe from.\nThis will override your current list!\n');
          settings.channels = String(channels).split(',')
          saveSettings(settings)
          showMenu(client);
          break;
        case '2':
          printSettings();
          const snipe_amt_op = await askQuestionAsync('\nChange snipe amount? (y/n)');
          if(String(snipe_amt_op).toLowerCase()=='y') {
            try {
              settings.snipeAmt = Number(await askQuestionAsync('Enter snipe amount: '));
              saveSettings(settings)
            } catch {
              console.log('Invalid input, please try again.')
            }
          }
          const slippage_op = await askQuestionAsync('\nChange slippage? (y/n)');
          if(String(slippage_op).toLowerCase()=='y') {
            try {
              settings.slippage = Number(await askQuestionAsync('Enter slippage: '));
              saveSettings(settings)
            } catch {
              console.log('Invalid input, please try again.')
            }
          }
          const buyAttempts_op = await askQuestionAsync('\nChange max buy attempts? (y/n)');
          if(String(buyAttempts_op).toLowerCase()=='y') {
            try {
              settings.buyAttempts = Number(await askQuestionAsync('Enter max buy attempts: '));
              saveSettings(settings)
            } catch {
              console.log('Invalid input, please try again.')
            }
          }
          const rpc_op = await askQuestionAsync('\nChange RPC? (y/n)');
          if(String(rpc_op).toLowerCase()=='y') {
            try {
              settings.rpcUrl = Number(await askQuestionAsync('Enter rpc url: '));
              saveSettings(settings)
            } catch {
              console.log('Invalid input, please try again.')
            }
          }
          const pkey_op = await askQuestionAsync('\nChange wallet? (y/n)');
          if(String(pkey_op).toLowerCase()=='y') {
            try {
              settings.secretkey = Number(await askQuestionAsync('Enter private key: '));
              saveSettings(settings)
            } catch {
              console.log('Invalid input, please try again.')
            }
          }
          console.log('Settings saved.')
          showMenu(client);
          break;
        case '3':
          console.log(settings.secretkey)
          showMenu(client);
          break;
        case '4':
          console.log('Press 4 again to stop sniper');
          toggleSniper(client);
          break;
        case '5':
          console.log('Exiting CLI. Goodbye!');
          rl.close();
          process.exit(0);
        default:
          console.log('Invalid option. Please try again.');
          showMenu(client);
          break;
      }
    }
  )
}

startCLI();
