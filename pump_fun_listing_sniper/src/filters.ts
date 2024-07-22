import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4, getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { MetadataAccountData, MetadataAccountDataArgs } from '@metaplex-foundation/mpl-token-metadata';
import { Serializer } from '@metaplex-foundation/umi/serializers';
import { NATIVE_MINT } from '@solana/spl-token';
import { fetchDexData, getHolderCount, getTokenPrice } from './utils.js';

export interface Filter {
  execute(poolKeysV4: LiquidityPoolKeysV4): Promise<FilterResult>;
}

export interface FilterResult {
  ok: boolean;
  message?: string;
}

export class PumpFilter implements Filter {
  constructor() {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    const endsWithPump = (str: string) => str.endsWith('pump');

    if (endsWithPump(poolKeys.baseMint.toString()) || endsWithPump(poolKeys.quoteMint.toString())) {
      return { ok: true };
    } else {
      return { ok: false };
    }
  }
}

export class MutableFilter implements Filter {
  private readonly errorMessage: string[] = [];

  constructor(
    private readonly connection: Connection,
    private readonly metadataSerializer: Serializer<MetadataAccountDataArgs, MetadataAccountData>,
    private readonly checkSocials: boolean,
  ) {
    if (this.checkSocials) {
      this.errorMessage.push('socials');
    }
  }

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const metadataPDA = getPdaMetadataKey(poolKeys.baseMint);
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey, this.connection.commitment);

      if (!metadataAccount?.data) {
        return { ok: false, message: 'Mutable -> Failed to fetch account data' };
      }

      const deserialize = this.metadataSerializer.deserialize(metadataAccount.data);
      const hasSocials = !this.checkSocials || (await this.hasSocials(deserialize[0]));
      const ok = hasSocials;
      const message: string[] = [];

      if (!hasSocials) {
        message.push('has no socials');
      }

      return { ok: ok, message: ok ? undefined : `MutableSocials -> Token ${message.join(' and ')}` };
    } catch (e) {
      console.log(e)
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint
      console.warn({ mint: token}, `MutableSocials -> Failed to check ${this.errorMessage.join(' and ')}`);
    }

    return {
      ok: false,
      message: `MutableSocials -> Failed to check ${this.errorMessage.join(' and ')}`,
    };
  }

  private async hasSocials(metadata) {
    const response = await fetch(metadata.uri);
    const data = await response.json();
    return Object.values(data?.extensions ?? {}).some((value: any) => value !== null && value.length > 0);
  }
}


export class MarketCapFilter implements Filter {
  constructor(
    private readonly connection: Connection,
    private readonly minMarketCap: number,
    private readonly maxMarketCap: number,
  ) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint

      const supply = await this.connection.getTokenSupply(token);
      const price = await getTokenPrice(token);
      const mktCap = supply.value.uiAmount! * price;
      let inRange = true;
      if (this.maxMarketCap != 0) {
        inRange = mktCap <= this.maxMarketCap;

        if (!inRange) {
          return { ok: false, message: `marketcap -> mkt cap ${mktCap} > ${this.maxMarketCap}` };
        }
      }
      if (this.minMarketCap != 0) {
        inRange = mktCap >= this.minMarketCap;

        if (!inRange) {
          return { ok: false, message: `marketcap -> mkt cap ${mktCap} < ${this.minMarketCap}` };
        }
      }

      return { ok: inRange };
    } catch (error) {
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint

      console.warn({ mint: token }, `Failed to check sol mkt cap`);
    }

    return { ok: false, message: 'PoolSize -> Failed to check sol mkt cap' };
  }
}

export class HolderCountFilter implements Filter {
  constructor(
    private readonly minHolderCount: number,
  ) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint

      const holderCount = await getHolderCount(token)
      let inRange = true;

      if (this.minHolderCount != 0) {
        inRange = holderCount >= this.minHolderCount;

        if (!inRange) {
          return { ok: false, message: `holder count -> count ${holderCount} < ${this.minHolderCount}` };
        }
      }

      return { ok: inRange };
    } catch (error) {
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint

      console.warn({ mint: token }, `Failed to check sol mkt cap`);
    }

    return { ok: false, message: 'PoolSize -> Failed to check sol mkt cap' };
  }
}

export class DexDataFilter implements Filter {
  constructor(
    private readonly interval: 'm5' | 'h1' | 'h6' | 'h24',
    private readonly minVolume: number,
    private readonly minBuys: number,
  ) {}

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    try {
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint

      const dexData = await fetchDexData([token.toString()]);
      console.log(dexData)
      const volume = dexData['volume'][this.interval]
      const buys = dexData['txns'][this.interval]['buys']
      let inRange = true;
      
      if (this.minBuys != 0) {
        inRange = buys >= this.minBuys;

        if (!inRange) {
          return { ok: false, message: `min buy # -> count ${buys} < ${this.minBuys}` };
        }
      }

      if (this.minVolume != 0) {
        inRange = volume >= this.minVolume;

        if (!inRange) {
          return { ok: false, message: `holder count -> count ${volume} < ${this.minVolume}` };
        }
      }

      return { ok: inRange };
    } catch (error) {
      const token = poolKeys.baseMint.toString()==NATIVE_MINT.toString() ? poolKeys.quoteMint: poolKeys.baseMint
      console.log(error)
      console.warn({ mint: token }, `Failed to fetch dex data`);
    }

    return { ok: false, message: 'Failed to fetch dex data' };
  }
}

export interface PoolFilterArgs {
  minMarketCap: number;
  maxMarketCap: number;
  minHolderCount: number;
  minVolume: number;
  minBuys: number;
  dexInterval: 'm5' | 'h1' | 'h6' | 'h24',
}

export class PoolFilters {
  private readonly filters: Filter[] = [];

  constructor(
    readonly connection: Connection,
    readonly args: PoolFilterArgs,
  ) {
    this.filters.push(new PumpFilter());
    //this.filters.push(new MutableFilter(connection, getMetadataAccountDataSerializer(), true));

    if (args.minMarketCap != 0 || args.maxMarketCap != 0 ) {
      this.filters.push(new MarketCapFilter(connection, args.minMarketCap, args.maxMarketCap));
    }

    if (args.minHolderCount!=0) {
      this.filters.push(new HolderCountFilter(args.minHolderCount))
    }

    if (args.minVolume!=0 || args.minBuys != 0) {
      this.filters.push(new DexDataFilter(args.dexInterval, args.minVolume, args.minBuys))
    }

  }

  public async execute(poolKeys: LiquidityPoolKeysV4): Promise<boolean> {
    if (this.filters.length === 0) {
      return true;
    }

    const result = await Promise.all(this.filters.map((f) => f.execute(poolKeys)));
    const pass = result.every((r) => r.ok);

    if (pass) {
      return true;
    }

    // for (const filterResult of result.filter((r) => !r.ok)) {
    //   console.log(filterResult.message);
    // }

    return false;
  }
}