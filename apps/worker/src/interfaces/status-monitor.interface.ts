import { Hash } from '@polkadot/types/interfaces';

export interface IStatusMonitorJob {
  txHash: Hash;
  publisherJobId: string;
}
