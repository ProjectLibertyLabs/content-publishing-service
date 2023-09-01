export interface IAssetJob {
  ipfsCid: string;
  mimeType: string;
  contentLocation: string;
}

export interface IAssetMetadata {
  ipfsCid: string;
  mimeType: string;
  createdOn: number;
}
