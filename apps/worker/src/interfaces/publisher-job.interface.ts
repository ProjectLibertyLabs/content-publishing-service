export enum PublisherJobType {
    IPFS = 'IPFS',
    OnChain = 'OnChain',
}
export interface IPublisherJob {
    id: string;
    type: PublisherJobType;
    schemaId: number;
    data: IPFSJobData;
}

export interface IPFSJobData {
    cid: string;
    payloadLength: number;
}
