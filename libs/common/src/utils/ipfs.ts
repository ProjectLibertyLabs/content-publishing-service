import * as ipfsHash from 'ipfs-only-hash';
// import { blake2b256 } from '@multiformats/blake2/blake2b';
// import { toMultibase } from '@dsnp/activity-content/hash';
import { CID } from 'multiformats';

export async function calculateIpfsCID(buffer: Buffer): Promise<string> {
  const v0 = await ipfsHash.of(buffer);
  return CID.parse(v0).toV1().toString();
}

// TODO: use after fixing ESM issue
// export const calculateDsnpHash = async (fileBuffer: Buffer): Promise<string> => {
//   const hash = await blake2b256.digest(fileBuffer);
//   return toMultibase(hash.bytes, 'blake2b-256');
// };
