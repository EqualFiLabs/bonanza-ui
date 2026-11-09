import { parseAbi } from "viem";

export const positionAbi = parseAbi([
  "function createPosition(address receiver) payable returns (uint256)",
  "function positionCreationFee() view returns (uint256)",
  "function positionCount(address owner) view returns (uint256)",
  "function positionsOfOwner(address owner, uint256 cursor, uint256 limit) view returns (uint256[] page, uint256 nextCursor)",
]);

export const operatorAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

export const activationAbi = parseAbi([
  "function multiplierBps(uint256 operatorId) view returns (uint16)",
]);

export const drandRegistryAbi = parseAbi([
  "function roundTime(uint64 round) pure returns (uint64)",
  "function hasSig(uint64 round) view returns (bool)",
]);
