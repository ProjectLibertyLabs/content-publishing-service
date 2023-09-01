import * as ipfsHash from 'ipfs-only-hash';
import { CID } from 'multiformats';

export async function calculateIpfsCID(buffer: Buffer): Promise<string> {
  const v0 = await ipfsHash.of(buffer);
  return CID.parse(v0).toV1().toString();
}
