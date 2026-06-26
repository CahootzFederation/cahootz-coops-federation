import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  createWallet,
  encryptPrivateKey,
  decryptPrivateKey,
  createWalletForUser,
  linkExternalWalletToUser,
} from '../services/wallet-service.js';
import { isAddress, isHex } from 'viem';

describe('Wallet Service', () => {
  beforeAll(() => {
    // Set encryption key for tests (64 hex characters = 32 bytes)
    if (!process.env.WALLET_ENCRYPTION_KEY) {
      process.env.WALLET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    }
  });

  describe('createWallet', () => {
    it('should create a valid Ethereum wallet', () => {
      const wallet = createWallet();

      // Should have address and privateKey
      expect(wallet).toHaveProperty('address');
      expect(wallet).toHaveProperty('privateKey');

      // Address should be valid Ethereum address
      expect(isAddress(wallet.address)).toBe(true);

      // Private key should be valid hex string starting with 0x
      expect(wallet.privateKey.startsWith('0x')).toBe(true);
      expect(isHex(wallet.privateKey)).toBe(true);
      expect(wallet.privateKey.length).toBe(66); // 0x + 64 hex chars
    });

    it('should create unique wallets each time', () => {
      const wallet1 = createWallet();
      const wallet2 = createWallet();

      expect(wallet1.address).not.toBe(wallet2.address);
      expect(wallet1.privateKey).not.toBe(wallet2.privateKey);
    });
  });

  describe('encryptPrivateKey', () => {
    it('should encrypt a private key', () => {
      const wallet = createWallet();
      const encrypted = encryptPrivateKey(wallet.privateKey);

      // Encrypted format: iv:authTag:encrypted
      expect(encrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);

      const [iv, authTag, ciphertext] = encrypted.split(':');
      expect(iv?.length).toBe(24); // 12 bytes = 24 hex chars
      expect(authTag?.length).toBe(32); // 16 bytes = 32 hex chars
      expect(ciphertext?.length).toBeGreaterThan(0);
    });

    it('should produce different ciphertext for same input (due to random IV)', () => {
      const wallet = createWallet();
      const encrypted1 = encryptPrivateKey(wallet.privateKey);
      const encrypted2 = encryptPrivateKey(wallet.privateKey);

      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt to same value
      const decrypted1 = decryptPrivateKey(encrypted1);
      const decrypted2 = decryptPrivateKey(encrypted2);
      expect(decrypted1).toBe(decrypted2);
      expect(decrypted1).toBe(wallet.privateKey);
    });
  });

  describe('decryptPrivateKey', () => {
    it('should decrypt to original private key', () => {
      const wallet = createWallet();
      const encrypted = encryptPrivateKey(wallet.privateKey);
      const decrypted = decryptPrivateKey(encrypted);

      expect(decrypted).toBe(wallet.privateKey);
    });

    it('should fail with invalid encrypted data format', () => {
      expect(() => {
        decryptPrivateKey('invalid-format');
      }).toThrow();
    });

    it('should fail with corrupted ciphertext', () => {
      const wallet = createWallet();
      const encrypted = encryptPrivateKey(wallet.privateKey);
      const [iv, authTag, _] = encrypted.split(':');
      const corrupted = `${iv}:${authTag}:corrupted`;

      expect(() => {
        decryptPrivateKey(corrupted);
      }).toThrow();
    });
  });

  describe('encryption security', () => {
    it('should use different IVs for each encryption', () => {
      const wallet = createWallet();
      const encrypted1 = encryptPrivateKey(wallet.privateKey);
      const encrypted2 = encryptPrivateKey(wallet.privateKey);

      const iv1 = encrypted1.split(':')[0];
      const iv2 = encrypted2.split(':')[0];

      expect(iv1).not.toBe(iv2);
    });
  });

  describe('round-trip encryption/decryption', () => {
    it('should preserve private key through multiple encrypt/decrypt cycles', () => {
      const wallet = createWallet();
      let current = wallet.privateKey;

      // Encrypt and decrypt 10 times
      for (let i = 0; i < 10; i++) {
        const encrypted = encryptPrivateKey(current);
        const decrypted = decryptPrivateKey(encrypted);
        expect(decrypted).toBe(wallet.privateKey);
        current = decrypted;
      }

      expect(current).toBe(wallet.privateKey);
    });
  });

  describe('managed wallet persistence', () => {
    it('writes legacy user fields and canonical Wallet row', async () => {
      const mockClient = {
        user: {
          findUnique: vi.fn().mockResolvedValue({
            walletAddress: null,
            encryptedPrivateKey: null,
            walletCreatedAt: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        wallet: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      };

      const address = await createWalletForUser('user_123', mockClient as any);

      expect(isAddress(address)).toBe(true);
      expect(mockClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user_123' },
        data: expect.objectContaining({
          walletAddress: address,
          encryptedPrivateKey: expect.any(String),
          walletCreatedAt: expect.any(Date),
        }),
      });
      expect(mockClient.wallet.upsert).toHaveBeenCalledWith({
        where: { address },
        update: expect.objectContaining({
          userId: 'user_123',
          walletType: 'MANAGED',
          isPrimary: true,
          custodyProvider: 'backend',
        }),
        create: expect.objectContaining({
          userId: 'user_123',
          address,
          walletType: 'MANAGED',
          isPrimary: true,
          custodyProvider: 'backend',
        }),
      });
    });
  });

  describe('external wallet linking', () => {
    it('creates a wallet-backed admin user and coop membership', async () => {
      const walletAddress = '0x1234567890123456789012345678901234567890';
      const mockClient = {
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'admin_user',
            email: `${walletAddress}@wallet.cahootz.coop`,
            walletAddress,
            roles: ['member', 'admin'],
            status: 'ACTIVE',
          }),
        },
        wallet: {
          upsert: vi.fn().mockResolvedValue({}),
        },
        userCoopMembership: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({}),
        },
      };

      const linked = await linkExternalWalletToUser({
        walletAddress,
        coopId: 'soulaan',
      }, mockClient as any);

      expect(linked).toEqual({ userId: 'admin_user', walletAddress });
      expect(mockClient.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: `${walletAddress}@wallet.cahootz.coop`,
          walletAddress,
          roles: ['member', 'admin'],
          status: 'ACTIVE',
        }),
      });
      expect(mockClient.wallet.upsert).toHaveBeenCalledWith({
        where: { address: walletAddress },
        update: expect.objectContaining({
          walletType: 'EXTERNAL',
          isPrimary: true,
          encryptedPrivateKey: null,
        }),
        create: expect.objectContaining({
          userId: 'admin_user',
          address: walletAddress,
          walletType: 'EXTERNAL',
          isPrimary: true,
        }),
      });
      expect(mockClient.userCoopMembership.upsert).toHaveBeenCalledWith({
        where: { userId_coopId: { userId: 'admin_user', coopId: 'soulaan' } },
        create: expect.objectContaining({
          status: 'ACTIVE',
          roles: ['member', 'admin'],
        }),
        update: expect.objectContaining({
          status: 'ACTIVE',
          roles: ['member', 'admin'],
        }),
      });
    });
  });
});
