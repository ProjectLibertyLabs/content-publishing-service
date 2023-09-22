import { Hash } from '@polkadot/types/interfaces';

export interface ITxMonitorJob {
  id: string;
  txHash: Hash;
  lastFinalizedBlockNumber: bigint;
  publisherJobId: string;
}
