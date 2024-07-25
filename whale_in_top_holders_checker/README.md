Basically code to check if the top holders are whales of any other tokens/Sol whales

Could def be improved but idc this was mainly for fun and bc someone on twitter challenged me 

Needs decent RPC (not free tier) and mainnet beta RPC default doesn't work bc of getProgramAccounts calls i think

To use

1. Make sure you're on Node v18+
2. ```npm install```
3. ```yarn run build```
4. ```node dist/index.js```


if you get some weird import error with raydium try running
```cp -f ./polyfil/package.json ./node_modules/@raydium-io/raydium-sdk/package.json```
and try again 

