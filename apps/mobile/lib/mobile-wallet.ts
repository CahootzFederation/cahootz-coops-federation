import { privateKeyToAccount } from 'viem/accounts';
import { secureStorage } from './secure-storage';

const WALLET_KEY_PREFIX = 'cahootz.wallet.privateKey';

function walletKey(userId: string, walletAddress: string): string {
  return `${WALLET_KEY_PREFIX}.${userId}.${walletAddress.toLowerCase()}`;
}

export function isValidPrivateKey(privateKey: string): privateKey is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(privateKey);
}

export async function storeLocalWalletPrivateKey(
  userId: string,
  walletAddress: string,
  privateKey: string
): Promise<void> {
  if (!isValidPrivateKey(privateKey)) {
    throw new Error('Invalid private key');
  }

  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('Private key does not match wallet address');
  }

  await secureStorage.setItem(walletKey(userId, walletAddress), privateKey);
}

export async function hasLocalWalletPrivateKey(userId: string, walletAddress: string): Promise<boolean> {
  const privateKey = await secureStorage.getItem(walletKey(userId, walletAddress));
  return !!privateKey && isValidPrivateKey(privateKey);
}

export async function signWalletMessage(
  userId: string,
  walletAddress: string,
  message: string
): Promise<string> {
  const privateKey = await secureStorage.getItem(walletKey(userId, walletAddress));

  if (!privateKey || !isValidPrivateKey(privateKey)) {
    throw new Error('Local wallet signing is not enabled');
  }

  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('Stored wallet key does not match this wallet');
  }

  return account.signMessage({ message });
}

export async function clearLocalWalletPrivateKey(userId: string, walletAddress: string): Promise<void> {
  await secureStorage.removeItem(walletKey(userId, walletAddress));
}
