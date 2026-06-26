// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

// Interface for future cross-coop clearing functionality
interface ICoopClearing {
    function recordCrossCoopActivity(uint256 fromCoopId, uint256 toCoopId, address member, bytes32 activityType) external;
}

interface IAllyCoinStatus {
    function isMember(address account) external view returns (bool);
}

// Custom errors for better debugging
error NotActiveMember(address account, uint8 currentStatus);
error ZeroAddress();
error ZeroAmount();
error ExceedsMaxAward(uint256 amount, uint256 maxAllowed);
error InsufficientBalance(address account, uint256 requested, uint256 available);
error AlreadyMember(address account);
error StatusAlreadySet(address account, uint8 status);
error MemberNotActive(address account);
error MemberNotSuspended(address account);
error AlreadyBanned(address account);

/**
 * @title SoulaaniCoin (SC)
 * @notice Non-transferable, soulbound governance and yield token for Cahootz co-ops
 * @dev ERC-20-based but with all transfers blocked (soulbound)
 *
 * SC is earned through sanctioned co-op activities:
 * - Paying rent in UC to verified landlords
 * - Spending UC at verified businesses
 * - Community service (e.g., neighborhood cleanup)
 * - Working on Co-op-funded projects
 * - Other approved co-op activities
 *
 * SC is used for:
 * - Voting on proposals and treasury allocation (with 2% voting power cap)
 * - Staking for yield from the Soulaan Wealth Fund
 * - Access to Co-op benefits
 *
 * Membership System (Hybrid On-Chain/Off-Chain):
 * - On-chain status: NotMember, Active, Suspended, Banned
 * - Only Active members can receive SC
 * - Membership status stored on blockchain (source of truth)
 * - Off-chain databases can query and cache this data
 * - All systems stay in sync by reading from blockchain
 *
 * Activity Tracking:
 * - Tracks total activities and activity types per member
 * - Awards can vary based on activity type and frequency
 * - Activity history is transparent and queryable
 *
 * Rules:
 * - Non-transferable (soulbound to wallet)
 * - Max 2% of total voting power per member (enforced in getVotingPower)
 * - Activity-based: more activities = more earning opportunities
 * - Must be active member to receive SC
 *
 * Roles:
 * - GOVERNANCE_MANAGER: Can manage inheritance and linked governance addresses
 * - GOVERNANCE_AWARD: Can award SC to members (governance bot/backend)
 * - GOVERNANCE_SLASH: Can slash/reduce SC (for violations)
 * - MEMBER_MANAGER: Can manage member status (add, suspend, ban members)
 * - DEFAULT_ADMIN: Can grant/revoke roles
 */
contract SoulaaniCoin is ERC20, ERC20Pausable, AccessControlEnumerable {
    // Role definitions
    bytes32 public constant GOVERNANCE_MANAGER = keccak256("GOVERNANCE_MANAGER");
    bytes32 public constant GOVERNANCE_AWARD = keccak256("GOVERNANCE_AWARD");
    bytes32 public constant GOVERNANCE_SLASH = keccak256("GOVERNANCE_SLASH");
    bytes32 public constant MEMBER_MANAGER = keccak256("MEMBER_MANAGER");

    // Membership status enum
    enum MemberStatus {
        NotMember, // 0: Never registered or removed
        Active, // 1: Active member, can receive SC
        Suspended, // 2: Temporarily suspended, cannot receive SC
        Banned // 3: Permanently banned, cannot receive SC
    }

    // Member tracking (blockchain source of truth)
    mapping(address => MemberStatus) public memberStatus;
    mapping(address => uint256) public memberSince; // Timestamp when became a member

    // Track activity metrics
    mapping(address => uint256) public lastActivity;
    mapping(address => uint256) public totalActivities; // Count of all activities
    mapping(address => mapping(bytes32 => uint256)) public activityTypeCount; // Count per activity type

    // SC-verified store registry (stores that earn SC rewards and trigger treasury reserves)
    mapping(address => bool) public scVerifiedStores;

    // Per-mint source UC transaction tracking
    struct MintRecord {
        address recipient;
        uint256 amount;
        bytes32 reason;
        bytes32 sourceUcTxHash; // UC transaction that triggered this SC mint (includes reserve transfer)
        uint256 treasuryReserveAmount; // Amount set aside to treasury in the same UC tx (in wei, 18 decimals)
        uint256 timestamp;
        address awarder;
    }
    
    MintRecord[] public mintHistory;
    mapping(bytes32 => uint256[]) public mintsBySourceTx; // UC tx hash => mint record indices

    struct BeneficiaryDesignation {
        address beneficiary;
        uint96 shareBps;
        bool active;
        uint256 updatedAt;
    }
    
    uint96 public constant BASIS_POINTS = 10_000;
    mapping(address => BeneficiaryDesignation[]) private inheritanceBeneficiaries;
    mapping(bytes32 => bool) public executedInheritanceCases;

    // Voting power cap (adjustable, default 2% of total supply)
    uint256 public maxVotingPowerPercent = 2;

    // Award and slash limits (per transaction, 0 = unlimited)
    uint256 public maxAwardPerTransaction = 0; // 0 = unlimited by default
    uint256 public maxSlashPerTransaction = 0; // 0 = unlimited by default

    // Diminishing returns thresholds and multipliers (in basis points, 10000 = 100%)
    uint256 public tier1Threshold = 50; // 0.5% of total supply (in basis points)
    uint256 public tier1Multiplier = 5000; // 50% earning rate (10000 = 100%)

    uint256 public tier2Threshold = 100; // 1.0% of total supply
    uint256 public tier2Multiplier = 2500; // 25% earning rate

    uint256 public tier3Threshold = 200; // 2.0% of total supply (hard cap)
    uint256 public tier3Multiplier = 100; // 1% earning rate (near-zero)

    // Time-based decay settings
    uint256 public decayInactivityPeriod = 365 days; // 12 months
    uint256 public decayRatePerMonth = 200; // 2% per month (in basis points)
    uint256 public lastDecayCheck; // Timestamp of last decay execution

    // Multi-coop foundation (minimal)
    uint256 public coopId = 1; // Default Cahootz co-op id
    address public clearingContract = address(0); // Future cross-coop clearing
    address public allyCoin = address(0);

    // Events
    event Awarded(address indexed recipient, uint256 amount, bytes32 indexed reason, address indexed awarder);
    
    event AwardedWithSource(
        address indexed recipient, 
        uint256 amount, 
        bytes32 indexed reason, 
        address indexed awarder,
        bytes32 sourceUcTxHash,
        uint256 mintRecordIndex
    );

    event Slashed(address indexed account, uint256 amount, bytes32 indexed reason, address indexed slasher);

    event ActivityRecorded(address indexed account, bytes32 indexed activityType, uint256 timestamp);

    event MemberStatusChanged(
        address indexed member,
        MemberStatus oldStatus,
        MemberStatus newStatus,
        address indexed changedBy
    );

    event MemberAdded(address indexed member, uint256 timestamp, address indexed addedBy);

    event VotingPowerCapChanged(uint256 oldPercent, uint256 newPercent, address indexed changedBy);

    event AwardLimitChanged(uint256 oldLimit, uint256 newLimit, address indexed changedBy);

    event SlashLimitChanged(uint256 oldLimit, uint256 newLimit, address indexed changedBy);

    event OwnershipTransferInitiated(address indexed from, address indexed to, uint256 timestamp);

    event OwnershipTransferCompleted(address indexed from, uint256 timestamp);

    // Multi-coop events
    event ClearingContractChanged(address indexed oldClearingContract, address indexed newClearingContract, address indexed changedBy);
    event CoopIdChanged(uint256 indexed oldCoopId, uint256 indexed newCoopId, address indexed changedBy);
    
    // Privileged Address Change Tracking Events
    event PrivilegedAddressChanged(
        string indexed changeType,
        address indexed oldAddress,
        address indexed newAddress,
        address changedBy,
        string reason,
        uint256 timestamp
    );
    
    event RoleGranted(
        bytes32 indexed role,
        address indexed account,
        address indexed sender,
        string reason,
        uint256 timestamp
    );
    
    event RoleRevoked(
        bytes32 indexed role,
        address indexed account,
        address indexed sender,
        string reason,
        uint256 timestamp
    );
    event CrossCoopActivity(uint256 indexed fromCoopId, uint256 indexed toCoopId, address indexed member, bytes32 activityType);

    // Diminishing returns and decay events
    event DiminishingRateApplied(address indexed recipient, uint256 requestedAmount, uint256 actualAmount, uint256 currentBalancePercent);
    event DiminishingRatesUpdated(address indexed updatedBy);
    event DecayExecuted(address indexed account, uint256 amount, uint256 monthsInactive);
    event DecayParametersUpdated(uint256 newInactivityPeriod, uint256 newDecayRate, address indexed updatedBy);

    // Store verification events
    event StoreVerificationChanged(address indexed store, bool isVerified, address indexed changedBy);
    event AllyCoinChanged(address indexed oldAllyCoin, address indexed newAllyCoin, address indexed changedBy);
    event InheritanceBeneficiariesUpdated(address indexed member, address indexed updatedBy);
    event InheritanceExecuted(
        bytes32 indexed caseId,
        address indexed deceased,
        address indexed beneficiary,
        uint256 amount,
        bytes32 reason,
        address executedBy
    );

    /**
     * @notice Constructor - initializes SC token
     * @param admin Address that will have admin role (can grant other roles)
     */
    constructor(address admin) ERC20("SoulaaniCoin", "SC") {
        require(admin != address(0), "Admin cannot be zero address");

        // Grant admin role to specified address
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // Admin starts with governance roles, can transfer them later
        _grantRole(GOVERNANCE_MANAGER, admin);
        _grantRole(GOVERNANCE_AWARD, admin);
        _grantRole(GOVERNANCE_SLASH, admin);
        _grantRole(MEMBER_MANAGER, admin);
    }

    /**
     * @notice Mint SC reward tokens to a member for completing an activity
     * @param recipient Address to receive SC
     * @param amount Amount of SC to mint (before diminishing returns)
     * @param reason Reason code for the award (e.g., keccak256("RENT_PAYMENT"), keccak256("BUSINESS_PURCHASE"), keccak256("COMMUNITY_SERVICE"))
     * @dev Only callable by GOVERNANCE_AWARD role (governance bot/backend)
     * @dev Applies diminishing returns and enforces 2% hard cap
     * @dev Recipient must be an active member to receive SC
     */
    function mintReward(
        address recipient,
        uint256 amount,
        bytes32 reason
    ) external onlyRole(GOVERNANCE_AWARD) whenNotPaused {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!isActiveMember(recipient)) revert NotActiveMember(recipient, uint8(memberStatus[recipient]));

        // Check award limit if set (0 = unlimited)
        if (maxAwardPerTransaction > 0) {
            if (amount > maxAwardPerTransaction) revert ExceedsMaxAward(amount, maxAwardPerTransaction);
        }

        // Apply diminishing returns based on current balance
        uint256 actualAmount = calculateDiminishedAmount(recipient, amount);

        // Enforce 2% hard cap - cannot mint if it would exceed max voting power
        // Only apply cap if total supply exists (allows bootstrapping from 0)
        uint256 currentBalance = balanceOf(recipient);
        uint256 supply = totalSupply();
        
        if (supply > 0) {
            uint256 maxBalance = getMaxVotingPower();
            
            if (currentBalance >= maxBalance) {
                // Already at or above cap - award nothing
                actualAmount = 0;
            } else if (currentBalance + actualAmount > maxBalance) {
                // Would exceed cap - only award up to the cap
                actualAmount = maxBalance - currentBalance;
            }
        }
        // If supply is 0, skip cap check to allow initial minting

        // Only mint if there's something to award
        if (actualAmount > 0) {
            _mint(recipient, actualAmount);
        }

        // Track activity metrics (even if actualAmount is 0, activity still counts)
        lastActivity[recipient] = block.timestamp;
        totalActivities[recipient] += 1;
        activityTypeCount[recipient][reason] += 1;

        // Optional: Notify clearing contract for cross-coop activity tracking
        if (clearingContract != address(0)) {
            try ICoopClearing(clearingContract).recordCrossCoopActivity(coopId, coopId, recipient, reason) {
                // Success - clearing contract handled the activity
            } catch {
                // Ignore clearing contract errors - don't fail the award
            }
        }

        emit Awarded(recipient, actualAmount, reason, msg.sender);
        emit ActivityRecorded(recipient, reason, block.timestamp);

        // Emit diminishing rate event if amount was reduced
        if (actualAmount < amount) {
            uint256 balancePercent = supply > 0 ? (currentBalance * 10000) / supply : 0;
            emit DiminishingRateApplied(recipient, amount, actualAmount, balancePercent);
        }
    }

    // 2-parameter version removed - use 3-parameter version with explicit reason for better gas efficiency

    /**
     * @notice Mint SC reward tokens with source UC transaction tracking
     * @param recipient Address to receive SC
     * @param amount Amount of SC to mint (before diminishing returns)
     * @param reason Reason code for the award
     * @param sourceUcTxHash UC transaction hash that triggered this reward (bytes32)
     * @param treasuryReserveAmount Amount set aside to treasury in the UC transaction (in wei, 18 decimals)
     * @dev Only callable by GOVERNANCE_AWARD role (governance bot/backend)
     * @dev Stores per-mint history linking SC mint to originating UC payment AND treasury reserve
     * @dev Applies diminishing returns and enforces 2% hard cap
     * @dev Recipient must be an active member to receive SC
     */
    function mintRewardWithSource(
        address recipient,
        uint256 amount,
        bytes32 reason,
        bytes32 sourceUcTxHash,
        uint256 treasuryReserveAmount
    ) external onlyRole(GOVERNANCE_AWARD) whenNotPaused {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!isActiveMember(recipient)) revert NotActiveMember(recipient, uint8(memberStatus[recipient]));

        // Check award limit if set (0 = unlimited)
        if (maxAwardPerTransaction > 0) {
            if (amount > maxAwardPerTransaction) revert ExceedsMaxAward(amount, maxAwardPerTransaction);
        }

        // Apply diminishing returns based on current balance
        uint256 actualAmount = calculateDiminishedAmount(recipient, amount);

        // Enforce 2% hard cap - cannot mint if it would exceed max voting power
        uint256 currentBalance = balanceOf(recipient);
        uint256 supply = totalSupply();
        
        if (supply > 0) {
            uint256 maxBalance = getMaxVotingPower();
            
            if (currentBalance >= maxBalance) {
                actualAmount = 0;
            } else if (currentBalance + actualAmount > maxBalance) {
                actualAmount = maxBalance - currentBalance;
            }
        }

        // Only mint if there's something to award
        if (actualAmount > 0) {
            _mint(recipient, actualAmount);
        }

        // Track activity metrics
        lastActivity[recipient] = block.timestamp;
        totalActivities[recipient] += 1;
        activityTypeCount[recipient][reason] += 1;

        // Store mint record with source UC tx reference and treasury reserve amount
        uint256 recordIndex = mintHistory.length;
        mintHistory.push(MintRecord({
            recipient: recipient,
            amount: actualAmount,
            reason: reason,
            sourceUcTxHash: sourceUcTxHash,
            treasuryReserveAmount: treasuryReserveAmount,
            timestamp: block.timestamp,
            awarder: msg.sender
        }));
        
        // Index by source UC tx for reverse lookup
        mintsBySourceTx[sourceUcTxHash].push(recordIndex);

        // Optional: Notify clearing contract for cross-coop activity tracking
        if (clearingContract != address(0)) {
            try ICoopClearing(clearingContract).recordCrossCoopActivity(coopId, coopId, recipient, reason) {
                // Success - clearing contract handled the activity
            } catch {
                // Ignore clearing contract errors - don't fail the award
            }
        }

        emit AwardedWithSource(recipient, actualAmount, reason, msg.sender, sourceUcTxHash, recordIndex);
        emit ActivityRecorded(recipient, reason, block.timestamp);

        // Emit diminishing rate event if amount was reduced
        if (actualAmount < amount) {
            uint256 balancePercent = supply > 0 ? (currentBalance * 10000) / supply : 0;
            emit DiminishingRateApplied(recipient, amount, actualAmount, balancePercent);
        }
    }

    /**
     * @notice Calculate earning multiplier based on current balance
     * @param recipient Address receiving the award
     * @param baseAmount Base amount before applying diminishing returns
     * @return actualAmount Amount after applying diminishing returns multiplier
     * @dev Implements tiered earning rates to prevent concentration
     */
    function calculateDiminishedAmount(address recipient, uint256 baseAmount) 
        public view returns (uint256 actualAmount) {
        uint256 currentBalance = balanceOf(recipient);
        uint256 supply = totalSupply();
        
        if (supply == 0) return baseAmount;
        
        // Calculate current balance as basis points of total supply
        uint256 balanceBasisPoints = (currentBalance * 10000) / supply;
        
        uint256 multiplier = 10000; // Default 100%
        
        // Apply tiered multipliers
        if (balanceBasisPoints >= tier3Threshold) {
            // At or above 2%: near-zero earning (1%)
            multiplier = tier3Multiplier;
        } else if (balanceBasisPoints >= tier2Threshold) {
            // At or above 1%: 25% earning rate
            multiplier = tier2Multiplier;
        } else if (balanceBasisPoints >= tier1Threshold) {
            // At or above 0.5%: 50% earning rate
            multiplier = tier1Multiplier;
        }
        // else: below 0.5%, full 100% earning rate
        
        actualAmount = (baseAmount * multiplier) / 10000;
        return actualAmount;
    }

    /**
     * @notice Slash (reduce) SC tokens from a member
     * @param account Address to slash from
     * @param amount Amount of SC to slash
     * @param reason Reason code for the slash (e.g., keccak256("INACTIVITY_DECAY"))
     * @dev Only callable by GOVERNANCE_SLASH role (governance bot/backend)
     */
    function slash(address account, uint256 amount, bytes32 reason) external onlyRole(GOVERNANCE_SLASH) whenNotPaused {
        require(account != address(0), "Cannot slash zero address");
        require(amount > 0, "Amount must be greater than 0");
        require(balanceOf(account) >= amount, "Insufficient balance to slash");

        // Check slash limit if set (0 = unlimited)
        if (maxSlashPerTransaction > 0) {
            require(amount <= maxSlashPerTransaction, "Amount exceeds max slash limit");
        }

        _burn(account, amount);

        // Optional: Notify clearing contract for cross-coop activity tracking
        if (clearingContract != address(0)) {
            try ICoopClearing(clearingContract).recordCrossCoopActivity(coopId, coopId, account, reason) {
                // Success - clearing contract handled the activity
            } catch {
                // Ignore clearing contract errors - don't fail the slash
            }
        }

        emit Slashed(account, amount, reason, msg.sender);
    }

    /**
     * @notice Slash multiple members in a batch
     * @param accounts Array of addresses to slash from
     * @param amounts Array of amounts to slash (must match accounts length)
     * @param reason Reason code for the slash
     * @dev Only callable by GOVERNANCE_SLASH role
     */
    function slashBatch(
        address[] calldata accounts,
        uint256[] calldata amounts,
        bytes32 reason
    ) external onlyRole(GOVERNANCE_SLASH) whenNotPaused {
        require(accounts.length == amounts.length, "Array length mismatch");
        require(accounts.length > 0, "Empty arrays");

        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 amount = amounts[i];

            require(account != address(0), "Cannot slash zero address");
            require(amount > 0, "Amount must be greater than 0");
            require(balanceOf(account) >= amount, "Insufficient balance to slash");

            // Check slash limit if set (0 = unlimited)
            if (maxSlashPerTransaction > 0) {
                require(amount <= maxSlashPerTransaction, "Amount exceeds max slash limit");
            }

            _burn(account, amount);
            emit Slashed(account, amount, reason, msg.sender);
        }
    }

    /**
     * @notice Update last activity timestamp for an address
     * @param account Address to update
     * @dev Can be called by governance to reset decay timer
     */
    function updateActivity(address account) external onlyRole(GOVERNANCE_AWARD) {
        require(account != address(0), "Cannot update zero address");
        lastActivity[account] = block.timestamp;
    }

    // ========== MEMBERSHIP MANAGEMENT ==========

    /**
     * @notice Add a new member to the co-op
     * @param member Address to add as a member
     * @dev Only callable by MEMBER_MANAGER role
     */
    function addMember(address member) external onlyRole(MEMBER_MANAGER) {
        require(member != address(0), "Cannot add zero address");
        require(memberStatus[member] == MemberStatus.NotMember, "Already a member or has status");

        memberStatus[member] = MemberStatus.Active;
        memberSince[member] = block.timestamp;

        emit MemberAdded(member, block.timestamp, msg.sender);
        emit MemberStatusChanged(member, MemberStatus.NotMember, MemberStatus.Active, msg.sender);
    }

    /**
     * @notice Add multiple members in a batch
     * @param members Array of addresses to add as members
     * @dev Only callable by MEMBER_MANAGER role
     */
    function addMembersBatch(address[] calldata members) external onlyRole(MEMBER_MANAGER) {
        for (uint256 i = 0; i < members.length; i++) {
            address member = members[i];
            if (member != address(0) && memberStatus[member] == MemberStatus.NotMember) {
                memberStatus[member] = MemberStatus.Active;
                memberSince[member] = block.timestamp;

                emit MemberAdded(member, block.timestamp, msg.sender);
                emit MemberStatusChanged(member, MemberStatus.NotMember, MemberStatus.Active, msg.sender);
            }
        }
    }

    /**
     * @notice Update a member's status
     * @param member Address of the member
     * @param newStatus New status to set
     * @dev Only callable by MEMBER_MANAGER role
     */
    function setMemberStatus(address member, MemberStatus newStatus) external onlyRole(MEMBER_MANAGER) {
        require(member != address(0), "Cannot update zero address");
        MemberStatus oldStatus = memberStatus[member];
        require(oldStatus != newStatus, "Status is already set to this value");

        memberStatus[member] = newStatus;

        emit MemberStatusChanged(member, oldStatus, newStatus, msg.sender);
    }

    /**
     * @notice Suspend a member (temporarily prevents receiving SC)
     * @param member Address of the member to suspend
     * @dev Only callable by MEMBER_MANAGER role
     */
    function suspendMember(address member) external onlyRole(MEMBER_MANAGER) {
        require(member != address(0), "Cannot suspend zero address");
        require(memberStatus[member] == MemberStatus.Active, "Member is not active");

        memberStatus[member] = MemberStatus.Suspended;

        emit MemberStatusChanged(member, MemberStatus.Active, MemberStatus.Suspended, msg.sender);
    }

    /**
     * @notice Reactivate a suspended member
     * @param member Address of the member to reactivate
     * @dev Only callable by MEMBER_MANAGER role
     */
    function reactivateMember(address member) external onlyRole(MEMBER_MANAGER) {
        require(member != address(0), "Cannot reactivate zero address");
        require(memberStatus[member] == MemberStatus.Suspended, "Member is not suspended");

        memberStatus[member] = MemberStatus.Active;

        emit MemberStatusChanged(member, MemberStatus.Suspended, MemberStatus.Active, msg.sender);
    }

    /**
     * @notice Ban a member permanently
     * @param member Address of the member to ban
     * @dev Only callable by MEMBER_MANAGER role
     */
    function banMember(address member) external onlyRole(MEMBER_MANAGER) {
        require(member != address(0), "Cannot ban zero address");
        require(memberStatus[member] != MemberStatus.Banned, "Member is already banned");

        MemberStatus oldStatus = memberStatus[member];
        memberStatus[member] = MemberStatus.Banned;

        emit MemberStatusChanged(member, oldStatus, MemberStatus.Banned, msg.sender);
    }

    /**
     * @notice Check if an address is an active member
     * @param account Address to check
     * @return bool True if member is active
     */
    function isActiveMember(address account) public view returns (bool) {
        return memberStatus[account] == MemberStatus.Active;
    }

    /**
     * @notice Check if an address is a registered member (any status except NotMember)
     * @param account Address to check
     * @return bool True if member is registered (Active, Suspended, or Banned)
     */
    function isMember(address account) public view returns (bool) {
        return memberStatus[account] != MemberStatus.NotMember;
    }

    /**
     * @notice Check if an address can receive SC (is active member)
     * @param account Address to check
     * @return bool True if can receive SC
     */
    function canReceiveSC(address account) public view returns (bool) {
        return memberStatus[account] == MemberStatus.Active;
    }

    /**
     * @notice Check if an address is also registered in AllyCoin
     * @param account Address to check
     * @return bool True if the address is registered in AllyCoin
     */
    function isAllyMember(address account) external view returns (bool) {
        if (allyCoin == address(0)) return false;
        return IAllyCoinStatus(allyCoin).isMember(account);
    }

    // ========== INHERITANCE MANAGEMENT ==========

    /**
     * @notice Set the beneficiary list for the caller's SC inheritance plan
     * @param beneficiaries Beneficiary wallet addresses
     * @param sharesBps Beneficiary shares in basis points (must total 10,000)
     */
    function setInheritanceBeneficiaries(
        address[] calldata beneficiaries,
        uint96[] calldata sharesBps
    ) external whenNotPaused {
        require(isMember(msg.sender), "Only registered members can set beneficiaries");
        require(beneficiaries.length == sharesBps.length, "Array length mismatch");
        require(beneficiaries.length > 0, "At least one beneficiary required");

        delete inheritanceBeneficiaries[msg.sender];

        uint256 totalShare;
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            address beneficiary = beneficiaries[i];
            uint96 shareBps = sharesBps[i];

            require(beneficiary != address(0), "Beneficiary cannot be zero address");
            require(shareBps > 0, "Beneficiary share must be greater than 0");

            for (uint256 j = 0; j < i; j++) {
                require(beneficiaries[j] != beneficiary, "Duplicate beneficiary");
            }

            inheritanceBeneficiaries[msg.sender].push(BeneficiaryDesignation({
                beneficiary: beneficiary,
                shareBps: shareBps,
                active: true,
                updatedAt: block.timestamp
            }));

            totalShare += shareBps;
        }

        require(totalShare == BASIS_POINTS, "Beneficiary shares must total 10,000 bps");
        emit InheritanceBeneficiariesUpdated(msg.sender, msg.sender);
    }

    /**
     * @notice Get the beneficiary designations for a member
     * @param member Address of the member
     * @return BeneficiaryDesignation[] Active beneficiary records
     */
    function getInheritanceBeneficiaries(address member) external view returns (BeneficiaryDesignation[] memory) {
        return inheritanceBeneficiaries[member];
    }

    /**
     * @notice Check whether an address is an active designated beneficiary for a member
     * @param member Address of the member
     * @param beneficiary Address of the beneficiary
     * @return bool True if active beneficiary record exists
     */
    function isDesignatedBeneficiary(address member, address beneficiary) public view returns (bool) {
        BeneficiaryDesignation[] storage designations = inheritanceBeneficiaries[member];
        for (uint256 i = 0; i < designations.length; i++) {
            if (designations[i].active && designations[i].beneficiary == beneficiary) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Execute an inheritance remint for a designated beneficiary
     * @param caseId Unique case identifier to prevent duplicate execution
     * @param deceased Address of the deceased member
     * @param beneficiary Address of the beneficiary receiving inherited SC
     * @param amount Amount of SC to reissue
     * @param reason Reason code for the inheritance execution
     */
    function executeInheritance(
        bytes32 caseId,
        address deceased,
        address beneficiary,
        uint256 amount,
        bytes32 reason
    ) external onlyRole(GOVERNANCE_MANAGER) whenNotPaused {
        require(caseId != bytes32(0), "Case ID cannot be zero");
        require(!executedInheritanceCases[caseId], "Inheritance case already executed");
        require(deceased != address(0), "Deceased cannot be zero address");
        require(beneficiary != address(0), "Beneficiary cannot be zero address");
        require(amount > 0, "Amount must be greater than 0");
        require(isDesignatedBeneficiary(deceased, beneficiary), "Beneficiary is not designated");
        require(balanceOf(deceased) >= amount, "Insufficient balance to inherit");

        executedInheritanceCases[caseId] = true;
        _activateInheritanceBeneficiary(beneficiary);

        _burn(deceased, amount);
        _mint(beneficiary, amount);
        lastActivity[beneficiary] = block.timestamp;

        emit InheritanceExecuted(caseId, deceased, beneficiary, amount, reason, msg.sender);
    }

    // ========== ACTIVITY TRACKING ==========

    /**
     * @notice Get time since last activity for an address
     * @param account Address to check
     * @return uint256 Seconds since last activity (0 if never active)
     */
    function getTimeSinceLastActivity(address account) external view returns (uint256) {
        if (lastActivity[account] == 0) return 0;
        return block.timestamp - lastActivity[account];
    }

    /**
     * @notice Get activity statistics for an address
     * @param account Address to check
     * @return total Total number of activities
     * @return lastActive Timestamp of last activity
     */
    function getActivityStats(address account) external view returns (uint256 total, uint256 lastActive) {
        return (totalActivities[account], lastActivity[account]);
    }

    /**
     * @notice Get count of specific activity type for an address
     * @param account Address to check
     * @param activityType The activity type (e.g., keccak256("RENT_PAYMENT"))
     * @return uint256 Count of that activity type
     */
    function getActivityTypeCount(address account, bytes32 activityType) external view returns (uint256) {
        return activityTypeCount[account][activityType];
    }

    // ========== TIME-BASED DECAY ==========

    /**
     * @notice Calculate decay amount for an inactive account
     * @param account Address to check
     * @return decayAmount Amount of SC that should be decayed
     * @dev Returns 0 if account is still active or has no balance
     */
    function calculateDecayAmount(address account) public view returns (uint256 decayAmount) {
        uint256 balance = balanceOf(account);
        if (balance == 0) return 0;
        
        uint256 lastActive = lastActivity[account];
        if (lastActive == 0) return 0;
        
        uint256 inactiveDuration = block.timestamp - lastActive;
        
        // No decay if inactive period hasn't been reached
        if (inactiveDuration < decayInactivityPeriod) {
            return 0;
        }
        
        // Calculate months of inactivity beyond the threshold
        uint256 monthsInactive = (inactiveDuration - decayInactivityPeriod) / 30 days;
        
        if (monthsInactive == 0) return 0;
        
        // Calculate decay: balance * months * rate
        // decayRatePerMonth is in basis points (200 = 2%)
        decayAmount = (balance * monthsInactive * decayRatePerMonth) / 10000;
        
        // Cap at total balance
        if (decayAmount > balance) {
            decayAmount = balance;
        }
        
        return decayAmount;
    }

    /**
     * @notice Execute decay for inactive members in batch
     * @param accounts Array of addresses to check and decay
     * @dev Can be called by GOVERNANCE_SLASH role (backend cron job)
     * @dev Only decays accounts that meet inactivity criteria
     */
    function executeDecayBatch(address[] calldata accounts) 
        external 
        onlyRole(GOVERNANCE_SLASH) 
        whenNotPaused 
    {
        bytes32 decayReason = keccak256("INACTIVITY_DECAY");
        
        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 decayAmount = calculateDecayAmount(account);
            
            if (decayAmount > 0) {
                // Calculate months for event
                uint256 inactiveDuration = block.timestamp - lastActivity[account];
                uint256 monthsInactive = (inactiveDuration - decayInactivityPeriod) / 30 days;
                
                _burn(account, decayAmount);
                emit Slashed(account, decayAmount, decayReason, msg.sender);
                emit DecayExecuted(account, decayAmount, monthsInactive);
            }
        }
        
        lastDecayCheck = block.timestamp;
    }

    // ========== VOTING POWER ==========

    /**
     * @notice Calculate voting power for an address
     * @param account Address to calculate voting power for
     * @return uint256 Voting power (capped at 2% of total supply)
     * @dev Voting power equals SC balance, but cannot exceed 2% of total supply
     */
    function getVotingPower(address account) public view returns (uint256) {
        uint256 balance = balanceOf(account);
        uint256 maxVotingPower = getMaxVotingPower();

        // Cap at 2% of total supply
        return balance > maxVotingPower ? maxVotingPower : balance;
    }

    /**
     * @notice Get maximum voting power (default 2% of total supply, adjustable)
     * @return uint256 Maximum voting power any single address can have
     */
    function getMaxVotingPower() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return (supply * maxVotingPowerPercent) / 100;
    }

    /**
     * @notice Check if an address has reached the voting power cap
     * @param account Address to check
     * @return bool True if at or above the cap
     */
    function isAtVotingPowerCap(address account) external view returns (bool) {
        return balanceOf(account) >= getMaxVotingPower();
    }

    // ========== ADMIN FUNCTIONS ==========

    /**
     * @notice Set the maximum voting power percentage
     * @param newPercent New maximum voting power percentage (1-10)
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe)
     */
    function setMaxVotingPowerPercent(uint256 newPercent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPercent > 0 && newPercent <= 10, "Percent must be between 1 and 10");
        uint256 oldPercent = maxVotingPowerPercent;
        maxVotingPowerPercent = newPercent;
        emit VotingPowerCapChanged(oldPercent, newPercent, msg.sender);
    }

    /**
     * @notice Set the maximum award amount per transaction
     * @param newLimit New maximum award limit (0 = unlimited)
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe)
     */
    function setMaxAwardPerTransaction(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = maxAwardPerTransaction;
        maxAwardPerTransaction = newLimit;
        emit AwardLimitChanged(oldLimit, newLimit, msg.sender);
    }

    /**
     * @notice Set the maximum slash amount per transaction
     * @param newLimit New maximum slash limit (0 = unlimited)
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe)
     */
    function setMaxSlashPerTransaction(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = maxSlashPerTransaction;
        maxSlashPerTransaction = newLimit;
        emit SlashLimitChanged(oldLimit, newLimit, msg.sender);
    }

    /**
     * @notice Set the linked AllyCoin contract address
     * @param newAllyCoin Address of the AllyCoin contract
     * @dev Only callable by GOVERNANCE_MANAGER
     */
    function setAllyCoin(address newAllyCoin, string calldata reason) external onlyRole(GOVERNANCE_MANAGER) {
        require(newAllyCoin != address(0), "AllyCoin cannot be zero address");
        address oldAllyCoin = allyCoin;
        allyCoin = newAllyCoin;
        emit AllyCoinChanged(oldAllyCoin, newAllyCoin, msg.sender);
        emit PrivilegedAddressChanged("ALLY_COIN", oldAllyCoin, newAllyCoin, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Pause all SC awards and slashing
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe) - Emergency use only
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause SC awards and slashing
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe)
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Initiate transfer of admin role to new address
     * @param newAdmin Address of new admin (typically a new multisig)
     * @dev New admin is granted role, old admin should call completeOwnershipTransfer after verification
     */
    function initiateOwnershipTransfer(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAdmin != address(0), "Cannot transfer to zero address");
        require(!hasRole(DEFAULT_ADMIN_ROLE, newAdmin), "Address already has admin role");

        grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        emit OwnershipTransferInitiated(msg.sender, newAdmin, block.timestamp);
    }

    /**
     * @notice Complete ownership transfer by renouncing old admin role
     * @dev Can only be called if there's another admin (prevents locking contract)
     */
    function completeOwnershipTransfer() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(getRoleMemberCount(DEFAULT_ADMIN_ROLE) > 1, "Would leave contract without admin");
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
        emit OwnershipTransferCompleted(msg.sender, block.timestamp);
    }

    /**
     * @notice Update diminishing returns tier thresholds and multipliers
     * @param newTier1Threshold Threshold for tier 1 in basis points (e.g., 50 = 0.5%)
     * @param newTier1Multiplier Multiplier for tier 1 in basis points (e.g., 5000 = 50%)
     * @param newTier2Threshold Threshold for tier 2 in basis points
     * @param newTier2Multiplier Multiplier for tier 2 in basis points
     * @param newTier3Threshold Threshold for tier 3 in basis points
     * @param newTier3Multiplier Multiplier for tier 3 in basis points
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setDiminishingRates(
        uint256 newTier1Threshold,
        uint256 newTier1Multiplier,
        uint256 newTier2Threshold,
        uint256 newTier2Multiplier,
        uint256 newTier3Threshold,
        uint256 newTier3Multiplier
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTier1Threshold < newTier2Threshold, "Tier 1 must be < Tier 2");
        require(newTier2Threshold < newTier3Threshold, "Tier 2 must be < Tier 3");
        require(newTier1Multiplier <= 10000, "Multiplier cannot exceed 100%");
        require(newTier2Multiplier <= 10000, "Multiplier cannot exceed 100%");
        require(newTier3Multiplier <= 10000, "Multiplier cannot exceed 100%");
        
        tier1Threshold = newTier1Threshold;
        tier1Multiplier = newTier1Multiplier;
        tier2Threshold = newTier2Threshold;
        tier2Multiplier = newTier2Multiplier;
        tier3Threshold = newTier3Threshold;
        tier3Multiplier = newTier3Multiplier;

        emit DiminishingRatesUpdated(msg.sender);
    }

    /**
     * @notice Update decay parameters
     * @param newInactivityPeriod Time period before decay starts (in seconds)
     * @param newDecayRatePerMonth Monthly decay rate in basis points (e.g., 200 = 2%)
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setDecayParameters(
        uint256 newInactivityPeriod,
        uint256 newDecayRatePerMonth
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newInactivityPeriod >= 180 days, "Inactivity period too short");
        require(newDecayRatePerMonth <= 1000, "Decay rate too high (max 10%)");
        
        decayInactivityPeriod = newInactivityPeriod;
        decayRatePerMonth = newDecayRatePerMonth;

        emit DecayParametersUpdated(newInactivityPeriod, newDecayRatePerMonth, msg.sender);
    }

    // ========== MINT HISTORY QUERIES ==========
    
    /**
     * @notice Get total number of mint records
     * @return uint256 Total mint history length
     */
    function getMintHistoryLength() external view returns (uint256) {
        return mintHistory.length;
    }
    
    /**
     * @notice Get mint record by index
     * @param index Index in mintHistory array
     * @return MintRecord struct with mint details
     */
    function getMintRecord(uint256 index) external view returns (MintRecord memory) {
        require(index < mintHistory.length, "Index out of bounds");
        return mintHistory[index];
    }
    
    /**
     * @notice Get all mint record indices for a given source UC transaction
     * @param sourceUcTxHash UC transaction hash (bytes32)
     * @return uint256[] Array of mint record indices
     */
    function getMintsBySourceTx(bytes32 sourceUcTxHash) external view returns (uint256[] memory) {
        return mintsBySourceTx[sourceUcTxHash];
    }
    
    /**
     * @notice Get mint records for a given source UC transaction
     * @param sourceUcTxHash UC transaction hash (bytes32)
     * @return MintRecord[] Array of mint records
     */
    function getMintRecordsBySourceTx(bytes32 sourceUcTxHash) external view returns (MintRecord[] memory) {
        uint256[] memory indices = mintsBySourceTx[sourceUcTxHash];
        MintRecord[] memory records = new MintRecord[](indices.length);
        
        for (uint256 i = 0; i < indices.length; i++) {
            records[i] = mintHistory[indices[i]];
        }
        
        return records;
    }

    // ========== SOULBOUND ENFORCEMENT ==========
    // Block all transfers, approvals, and allowances

    /**
     * @notice Transfers are blocked - SC is soulbound
     */
    function transfer(address, uint256) public pure override returns (bool) {
        revert("SC is non-transferable (soulbound)");
    }

    /**
     * @notice Transfers are blocked - SC is soulbound
     */
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("SC is non-transferable (soulbound)");
    }

    /**
     * @notice Approvals are blocked - SC is soulbound
     */
    function approve(address, uint256) public pure override returns (bool) {
        revert("SC is non-transferable (soulbound)");
    }

    /**
     * @notice Allowances are blocked - SC is soulbound
     */
    function allowance(address, address) public pure override returns (uint256) {
        return 0;
    }

    /**
     * @notice IncreaseAllowance is blocked - SC is soulbound
     */
    function increaseAllowance(address, uint256) public pure returns (bool) {
        revert("SC is non-transferable (soulbound)");
    }

    /**
     * @notice DecreaseAllowance is blocked - SC is soulbound
     */
    function decreaseAllowance(address, uint256) public pure returns (bool) {
        revert("SC is non-transferable (soulbound)");
    }

    /**
     * @dev Override required by Solidity for multiple inheritance
     */
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, value);
    }

    /**
     * @dev Override required by Solidity for AccessControlEnumerable
     */
    function supportsInterface(bytes4 interfaceId) public view override(AccessControlEnumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ========== STORE VERIFICATION MANAGEMENT ==========

    /**
     * @notice Add or remove SC-verified store
     * @param store Store wallet address
     * @param isVerified True to add, false to remove
     * @dev Only callable by GOVERNANCE_AWARD role (backend)
     * @dev SC-verified stores earn SC rewards and trigger automatic treasury reserves in UC
     */
    function setStoreVerification(address store, bool isVerified) external onlyRole(GOVERNANCE_AWARD) {
        require(store != address(0), "Store cannot be zero address");
        scVerifiedStores[store] = isVerified;
        emit StoreVerificationChanged(store, isVerified, msg.sender);
    }

    /**
     * @notice Check if a store is SC-verified
     * @param store Store wallet address
     * @return bool True if store is SC-verified
     */
    function isScVerifiedStore(address store) external view returns (bool) {
        return scVerifiedStores[store];
    }

    // ========== MULTI-COOP ADMIN FUNCTIONS ==========

    /**
     * @notice Set the clearing contract address for cross-coop functionality
     * @param newClearingContract Address of the clearing contract
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @dev Used for future multi-coop cross-settlement
     */
    function setClearingContract(address newClearingContract, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newClearingContract != address(0), "Clearing contract cannot be zero address");
        address oldClearingContract = clearingContract;
        clearingContract = newClearingContract;
        emit ClearingContractChanged(oldClearingContract, newClearingContract, msg.sender);
        emit PrivilegedAddressChanged("CLEARING_CONTRACT", oldClearingContract, newClearingContract, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Set the coop ID for this contract
     * @param newCoopId New coop ID to assign
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     * @dev Used for future multi-coop identification
     */
    function setCoopId(uint256 newCoopId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCoopId > 0, "Coop ID must be greater than 0");
        uint256 oldCoopId = coopId;
        coopId = newCoopId;
        emit CoopIdChanged(oldCoopId, newCoopId, msg.sender);
    }

    /**
     * @notice Grant role with audit trail
     * @param role Role to grant
     * @param account Address to grant role to
     * @param reason Reason for granting the role
     * @dev Only callable by role admin
     */
    function grantRoleWithReason(bytes32 role, address account, string calldata reason) external {
        grantRole(role, account);
        emit RoleGranted(role, account, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Revoke role with audit trail
     * @param role Role to revoke
     * @param account Address to revoke role from
     * @param reason Reason for revoking the role
     * @dev Only callable by role admin
     */
    function revokeRoleWithReason(bytes32 role, address account, string calldata reason) external {
        revokeRole(role, account);
        emit RoleRevoked(role, account, msg.sender, reason, block.timestamp);
    }

    function _activateInheritanceBeneficiary(address beneficiary) internal {
        require(memberStatus[beneficiary] != MemberStatus.Banned, "Beneficiary is banned");

        MemberStatus oldStatus = memberStatus[beneficiary];
        if (oldStatus == MemberStatus.Active) {
            return;
        }

        memberStatus[beneficiary] = MemberStatus.Active;
        if (oldStatus == MemberStatus.NotMember) {
            memberSince[beneficiary] = block.timestamp;
            emit MemberAdded(beneficiary, block.timestamp, msg.sender);
        }

        emit MemberStatusChanged(beneficiary, oldStatus, MemberStatus.Active, msg.sender);
    }
}
