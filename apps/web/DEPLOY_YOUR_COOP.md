# 🚀 Deploy Your Own Commons

## Quick Start

Visit the initialize page to deploy your own commons instance in minutes:

```
https://your-domain.com/initialize
```

Or locally:
```bash
pnpm dev:web
# Then visit: http://localhost:3000/initialize
```

## What You'll Need

### For Testnet (Base Sepolia)
1. **MetaMask or compatible wallet**
2. **Test ETH** (free from faucet)
   - Get it here: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
3. **5 minutes of time**

### For Mainnet (Base)
1. **MetaMask or compatible wallet**
2. **~0.1 ETH** for gas fees
3. **Multisig Safe address** (create at https://safe.global)
4. **Governance bot wallet address**
5. **Security audit** (recommended)

## Step-by-Step Process

### Phase 1: Configure Your Commons

Fill in the form with your commons details:

**Identity:**
- What's your commons called?
- What's your tagline?
- What colors represent your brand?

**Governance:**
- How many members must vote? (Quorum %)
- What % of votes needed to pass?
- How long should voting windows be?
- What AI screening threshold?

**Payment Settings:**
- Transaction limits
- Claim expiration
- Withdrawal minimums

**Fees:**
- P2P transfer fees
- Withdrawal fees

**Addresses:**
- Treasury Safe (or leave blank to use your wallet)
- Governance Bot (or leave blank to use your wallet)

### Phase 2: Select Optional Contracts

Choose which contracts to deploy based on your needs:

**Required (always deployed):**
- ✅ **SoulaaniCoin (SC)** - Governance token
- ✅ **AllyCoin (ALLY)** - Cross-commons membership
- ✅ **UnityCoin (UC)** - Payment currency

**Optional (check to deploy):**
- ⬜ **RedemptionVault** - Self-service redemptions (~$20-30)
- ⬜ **VerifiedStoreRegistry** - On-chain store verification (~$20-30)
- ⬜ **SCRewardEngine** - Automatic reward calculation (~$20-30)
- ⬜ **StorePaymentRouter** - Payment routing system (~$20-30)

**Cost estimates on mainnet:**
- Minimal (3 contracts): ~$60-90
- With vault (4 contracts): ~$110-160
- Full setup (7 contracts): ~$160-320

### Phase 3: Deploy Contracts

Click "Start Deployment" and watch the process:

1. ✅ **SoulaaniCoin** deploys
2. ✅ **AllyCoin** deploys and links to SC
3. ✅ **UnityCoin** deploys
4. ✅ Optional contracts deploy (if selected)
5. ✅ **Roles granted** (permissions configured)
6. ✅ **Saved to database** (commons registered in system)

Each step shows:
- Real-time status
- Transaction hash (click to view on BaseScan)
- Contract address (click to copy)

### Phase 4: Complete & Download

**Your commons is now live!** It's registered in the database and visible in the mobile app.

Download two files:

1. **JSON Config** - Full deployment record
   - All contract addresses
   - All configuration settings
   - Deployment metadata
   - Keep this for your records!

2. **.env File** - Ready for your backend
   - Copy to your API server
   - Restart backend
   - You're ready to go!

**Mobile App Integration:**
- Your commons now appears in the mobile app's onboarding flow
- New members can discover and apply to join
- Existing members can switch to your commons

## What Gets Deployed

### Smart Contracts (3-7 depending on selection)

| Contract | Purpose | Required | Size |
|----------|---------|----------|------|
| SoulaaniCoin | Governance token | ✅ Yes | 85KB |
| AllyCoin | Cross-commons membership | ✅ Yes | 78KB |
| UnityCoin | Main payment currency | ✅ Yes | 92KB |
| SoulaaniCoin | Governance token (voting power) | 141KB |
| RedemptionVault | Converts UC back to USD | ⬜ Optional | 71KB |
| VerifiedStoreRegistry | Manages verified stores | ⬜ Optional | 35KB |
| SCRewardEngine | Calculates SC rewards | ⬜ Optional | 49KB |
| StorePaymentRouter | Routes payments & rewards | ⬜ Optional | 39KB |

### Automatic Role Setup

The page automatically configures:
- Reward engine can mint SC tokens
- Payment router can trigger rewards
- Treasury can manage all contracts

## After Deployment

### Your Commons is Live!

✅ **Contracts deployed** to blockchain  
✅ **Commons registered** in database  
✅ **Visible in mobile app** - new members can discover and join

### Immediate Next Steps

1. **Save your files**
   - Download JSON config
   - Download .env file
   - Back them up securely

2. **Add to backend**
   ```bash
   # Copy .env file to your API server
   cp .env.your-commons apps/api/.env
   
   # Restart API
   pnpm dev:api
   ```

3. **Test in mobile app**
   - Open the mobile app
   - Go to onboarding/commons selection
   - Your commons should appear in the list!

3. **Verify contracts** (optional but recommended)
   ```bash
   # Copy commands from success screen
   npx hardhat verify --network baseSepolia 0x... [args]
   ```

### Production Checklist

- [ ] Create multisig Safe for treasury
- [ ] Generate dedicated governance bot wallet
- [ ] Fund governance bot with gas ETH
- [ ] Deploy to mainnet
- [ ] Verify all contracts on BaseScan
- [ ] Transfer admin roles to multisig
- [ ] Revoke deployer's admin access
- [ ] Set up event indexing
- [ ] Configure reward policies
- [ ] Register initial verified stores
- [ ] Test end-to-end flows

## Example Configuration

### Community Commons
```
Name: Oakland Community Commons
Short Name: Oakland
Tagline: Building Economic Power Together
Quorum: 20%
Approval: 60%
Voting Window: 10 days
```

### Artist Commons
```
Name: SF Artist Collective
Short Name: SFAC
Tagline: Supporting Creative Livelihoods
Quorum: 15%
Approval: 51%
Voting Window: 7 days
```

### Worker Commons
```
Name: Tech Workers United
Short Name: TWU
Tagline: Worker-Owned Technology
Quorum: 25%
Approval: 66%
Voting Window: 14 days
```

## Cost Estimates

### Testnet (Base Sepolia)
- **Gas Cost:** FREE (test ETH)
- **Time:** 2-5 minutes
- **Transactions:** 7-8 txs

### Mainnet (Base)
- **Gas Cost:** ~0.05-0.1 ETH (~$150-300)
- **Time:** 2-5 minutes
- **Transactions:** 7-8 txs

*Costs vary based on network congestion*

## Troubleshooting

### Wallet won't connect
- Make sure you're on the correct network
- Try refreshing the page
- Try a different wallet

### Transaction failed
- Check you have enough ETH
- Increase gas limit if needed
- Wait and try again

### Deployment stuck
- Check transaction on BaseScan
- May need to wait for network congestion
- Can resume from failed step

### Can't download files
- Check browser popup blocker
- Try different browser
- Copy addresses manually

## Security Best Practices

### ✅ DO
- Use multisig Safe for production treasury
- Generate dedicated governance bot wallet
- Test on testnet first
- Back up configuration files
- Verify contracts on BaseScan
- Keep private keys secure

### ❌ DON'T
- Use personal wallet as treasury on mainnet
- Share private keys
- Commit .env files to git
- Skip testnet testing
- Deploy without backup plan

## Support

Need help?
- Check `apps/web/INITIALIZE_GUIDE.md` for detailed docs
- Review `packages/contracts/DEPLOYMENT_GUIDE.md`
- See `DEV_GUIDE.md` for backend integration
- Create GitHub issue for bugs

---

**Ready to build your commons?** Visit `/initialize` and get started! 🎉
