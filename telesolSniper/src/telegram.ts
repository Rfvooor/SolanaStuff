import { TelegramClient } from 'telegram';
import { loadSettingsFile, saveSettings } from './settings.js';
import { askPassword, askQuestionAsync, showMenu } from './index.js';
import {NewMessageEvent, NewMessage} from "telegram/events/index.js"
import { swap } from './swap.js';


export async function performTelegramLogin() {
  const settings = loadSettingsFile()
  try {
    if(!settings.apiId || !settings.apiHash) {
      console.log("To log into telegram so the bot can recieve alerts from the account you want to snipe from, you'll first need to create an api_id and api_hash to register your bot.\nThese can be found here: https://my.telegram.org/apps")
    }
    const apiId = settings.apiId || await askQuestionAsync('Please enter your api_id:  ');
    const apiHash = settings.apiHash || await askQuestionAsync('Please enter your api_hash: ');
    const client = new TelegramClient("anon", Number(apiId), String(apiHash), {
      connectionRetries: 5,
    });
    console.log('Verified bot access, proceeding to signin')
    const ph = String(await askQuestionAsync('Please enter your number (international format): '))
    const pwd = String(askPassword());
    await client.start({
      phoneNumber: async () => ph,
      password: async () => pwd,
      phoneCode: async () => String(await askQuestionAsync('Please enter the code you received: ')),
      onError: (err: Error) => {console.log('Error with login, please try again');throw err}
    });
    //settings.tgsession = client.session.save();
    settings.apiId = apiId;
    settings.apiHash = apiHash;
    saveSettings(settings);
    console.log("You should now be connected.");
    return client;
  } catch (error) {
    console.error('Error logging into Telegram:', error);
  }
  
}

function checkIfAnyStringExists(stringsToCheck: string[], listToSearch: string[]): boolean {
  return stringsToCheck.some(str => listToSearch.includes(str));
}

export const snipeMessage = async (event: NewMessageEvent) => {
  try{
    const settings = loadSettingsFile()
    const message = event.message;
    const sender = await message.getSender();
    let r = false;
    const message_sender: string[] = []
    if (sender && sender.hasOwnProperty('title')) {
      // @ts-ignore
      message_sender.push(sender.title)
    }
    if (sender && sender.hasOwnProperty('username')) {
      // @ts-ignore
      message_sender.push(sender.username)
    }
    const m = checkIfAnyStringExists(message_sender, settings.channels)
    if(m) {
      event.message.entities?.forEach(
        (val)=> {
          if('url' in val&& val.url) {
            if(r) {
              return;
            }
            r = swap(val.url)
          }
        }
      );
      if(r) {
        return;
      }
      r = swap(message)
      
    } 
  } catch(e) {
    console.log(e)
  }
}

export async function tgListener(client) {
  Promise.resolve(client.getMe()).then(
    ()=> {
      client.addEventHandler(snipeMessage, new NewMessage({}));
      
    }
  )
}