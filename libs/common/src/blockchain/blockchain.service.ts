/* eslint-disable no-underscore-dangle */
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ApiPromise, ApiRx, HttpProvider, WsProvider } from '@polkadot/api';
import { firstValueFrom } from 'rxjs';
import { options } from '@frequency-chain/api-augment';
import { KeyringPair } from '@polkadot/keyring/types';
import { BlockHash, BlockNumber, DispatchError, DispatchInfo, Hash, SignedBlock } from '@polkadot/types/interfaces';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { AnyNumber, ISubmittableResult, RegistryError } from '@polkadot/types/types';
import { u32, Option } from '@polkadot/types';
import { PalletCapacityCapacityDetails, PalletCapacityEpochInfo, PalletSchemasSchema } from '@polkadot/types/lookup';
import { ConfigService } from '../config/config.service';
import { Extrinsic } from './extrinsic';

@Injectable()
export class BlockchainService implements OnApplicationBootstrap, OnApplicationShutdown {
  public api: ApiRx;

  public apiPromise: ApiPromise;

  private configService: ConfigService;

  private logger: Logger;

  public async onApplicationBootstrap() {
    const providerUrl = this.configService.frequencyUrl!;
    let provider: any;
    if (/^ws/.test(providerUrl.toString())) {
      provider = new WsProvider(providerUrl.toString());
    } else if (/^http/.test(providerUrl.toString())) {
      provider = new HttpProvider(providerUrl.toString());
    } else {
      this.logger.error(`Unrecognized chain URL type: ${providerUrl.toString()}`);
      throw new Error('Unrecognized chain URL type');
    }
    this.api = await firstValueFrom(ApiRx.create({ provider, ...options }));
    this.apiPromise = await ApiPromise.create({ provider, ...options });
    await Promise.all([firstValueFrom(this.api.isReady), this.apiPromise.isReady]);
    this.logger.log('Blockchain API ready.');
  }

  public async onApplicationShutdown(signal?: string | undefined) {
    const promises: Promise<any>[] = [];
    if (this.api) {
      promises.push(this.api.disconnect());
    }

    if (this.apiPromise) {
      promises.push(this.apiPromise.disconnect());
    }
    await Promise.all(promises);
  }

  constructor(configService: ConfigService) {
    this.configService = configService;
    this.logger = new Logger(this.constructor.name);
  }

  public getBlockHash(block: BlockNumber | AnyNumber): Promise<BlockHash> {
    return this.apiPromise.rpc.chain.getBlockHash(block);
  }

  public getBlock(block: BlockHash): Promise<SignedBlock> {
    return this.apiPromise.rpc.chain.getBlock(block);
  }

  public async getLatestFinalizedBlockHash(): Promise<BlockHash> {
    return (await this.apiPromise.rpc.chain.getFinalizedHead()) as BlockHash;
  }

  public async getLatestFinalizedBlockNumber(): Promise<bigint> {
    return (await this.apiPromise.rpc.chain.getBlock()).block.header.number.toBigInt();
  }

  public async getBlockNumberForHash(hash: string): Promise<number | undefined> {
    const block = await this.apiPromise.rpc.chain.getBlock(hash);
    if (block) {
      return block.block.header.number.toNumber();
    }

    this.logger.error(`No block found corresponding to hash ${hash}`);
    return undefined;
  }

  public createType(type: string, ...args: (any | undefined)[]) {
    return this.api.registry.createType(type, ...args);
  }

  public createExtrinsicCall({ pallet, extrinsic }: { pallet: string; extrinsic: string }, ...args: (any | undefined)[]): SubmittableExtrinsic<'rxjs', ISubmittableResult> {
    return this.api.tx[pallet][extrinsic](...args);
  }

  public createExtrinsic(
    { pallet, extrinsic }: { pallet: string; extrinsic: string },
    { eventPallet, event }: { eventPallet?: string; event?: string },
    keys: KeyringPair,
    ...args: (any | undefined)[]
  ): Extrinsic {
    const targetEvent = eventPallet && event ? this.api.events[eventPallet][event] : undefined;
    return new Extrinsic(this.api, this.api.tx[pallet][extrinsic](...args), keys, targetEvent);
  }

  public rpc(pallet: string, rpc: string, ...args: (any | undefined)[]): Promise<any> {
    return this.apiPromise.rpc[pallet][rpc](...args);
  }

  public query(pallet: string, extrinsic: string, ...args: (any | undefined)[]): Promise<any> {
    return args ? this.apiPromise.query[pallet][extrinsic](...args) : this.apiPromise.query[pallet][extrinsic]();
  }

  public async queryAt(blockHash: BlockHash, pallet: string, extrinsic: string, ...args: (any | undefined)[]): Promise<any> {
    const newApi = await this.apiPromise.at(blockHash);
    return newApi.query[pallet][extrinsic](...args);
  }

  public async capacityInfo(providerId: string): Promise<{
    providerId: string;
    currentBlockNumber: number;
    nextEpochStart: number;
    remainingCapacity: bigint;
    totalCapacityIssued: bigint;
    currentEpoch: bigint;
  }> {
    const providerU64 = this.api.createType('u64', providerId);
    const { epochStart }: PalletCapacityEpochInfo = await this.query('capacity', 'currentEpochInfo');
    const epochBlockLength: u32 = await this.query('capacity', 'epochLength');
    const capacityDetailsOption: Option<PalletCapacityCapacityDetails> = await this.query('capacity', 'capacityLedger', providerU64);
    const { remainingCapacity, totalCapacityIssued } = capacityDetailsOption.unwrapOr({ remainingCapacity: 0, totalCapacityIssued: 0 });
    const currentBlock: u32 = await this.query('system', 'number');
    const currentEpoch = await this.getCurrentCapacityEpoch();
    return {
      currentEpoch,
      providerId,
      currentBlockNumber: currentBlock.toNumber(),
      nextEpochStart: epochStart.add(epochBlockLength).toNumber(),
      remainingCapacity: typeof remainingCapacity === 'number' ? BigInt(remainingCapacity) : remainingCapacity.toBigInt(),
      totalCapacityIssued: typeof totalCapacityIssued === 'number' ? BigInt(totalCapacityIssued) : totalCapacityIssued.toBigInt(),
    };
  }

  public async getCurrentCapacityEpoch(): Promise<bigint> {
    const currentEpoch: u32 = await this.query('capacity', 'currentEpoch');
    return typeof currentEpoch === 'number' ? BigInt(currentEpoch) : currentEpoch.toBigInt();
  }

  public async getCurrentEpochLength(): Promise<number> {
    const epochLength: u32 = await this.query('capacity', 'epochLength');
    return typeof epochLength === 'number' ? epochLength : epochLength.toNumber();
  }

  public async capacityBatchLimit(): Promise<number> {
    return this.api.consts.frequencyTxPayment.maximumCapacityBatchLength.toNumber();
  }

  public async getSchema(schemaId: number): Promise<PalletSchemasSchema> {
    const schema: PalletSchemasSchema = await this.query('schemas', 'schemas', schemaId);
    return schema;
  }

  public async crawlBlockListForTx(
    txHash: Hash,
    blockList: bigint[],
    capacityCallback: (capacityWithDrawn: bigint) => void,
    errorCallback: (moduleError: RegistryError) => void,
  ): Promise<BlockHash | undefined> {
    const txReceiptPromises: Promise<BlockHash | undefined>[] = blockList.map(async (blockNumber) => {
      const blockHash = await this.getBlockHash(blockNumber);
      const block = await this.getBlock(blockHash);
      const txInfo = block.block.extrinsics.find((extrinsic) => extrinsic.hash.toString() === txHash.toString());
      this.logger.debug(`Extrinsics: ${block.block.extrinsics[0]}`);

      if (txInfo !== undefined) {
        this.logger.verbose(`Found tx ${txHash} in block ${blockNumber}`);
        const at = await this.api.at(blockHash.toHex());
        const events = await at.query.system.events();
        let isMessageSuccess = false;
        let capacityWithDrawn: bigint = 0n;

        events.subscribe((records) => {
          records.forEach(async (record) => {
            const { event } = record;
            const eventName = event.section;
            const { method } = event;
            const { data } = event;
            this.logger.debug(`Received event: ${eventName} ${method} ${data}`);

            if (eventName.search('capacity') !== -1 && method.search('Withdrawn') !== -1) {
              capacityWithDrawn = BigInt(data[1].toString());
              this.logger.debug(`Capacity withdrawn: ${capacityWithDrawn}`);
              capacityCallback(capacityWithDrawn);
            }

            if (eventName.search('messages') !== -1 && method.search('MessageStored') !== -1) {
              isMessageSuccess = true;
            }

            if (eventName.search('system') !== -1 && method.search('ExtrinsicFailed') !== -1) {
              isMessageSuccess = false;
              const dispatchError = data[0] as DispatchError;
              const dispatchInfo = data[1] as DispatchInfo;
              this.logger.warn(`Extrinsic failed with error: ${dispatchError}`);
              this.logger.warn(`Extrinsic failed with info: ${dispatchInfo}`);

              const moduleThatErrored = dispatchError.asModule;
              const moduleError = dispatchError.registry.findMetaError(moduleThatErrored);
              this.logger.error(`Module error: ${moduleError}`);
              errorCallback(moduleError);
            }
          });
        });

        if (isMessageSuccess) {
          this.logger.verbose(`Successfully found submitted ipfs message ${txHash} in block ${blockHash}`);
          return blockHash;
        }
      }

      return undefined;
    });

    const results = await Promise.all(txReceiptPromises);
    const result = results.find((blockHash) => blockHash !== undefined);
    return result;
  }
}
