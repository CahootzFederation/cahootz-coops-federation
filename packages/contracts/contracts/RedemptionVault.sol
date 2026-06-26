// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./UnityCoin.sol";

/**
 * @title RedemptionVault
 * @notice Vault for USDC onboarding and UC redemption
 * @dev Handles both USDC → UC (onboarding) and UC → USDC (redemption) flows
 *
 * USDC Onboarding Flow:
 * 1. User deposits USDC to vault
 * 2. Vault mints UC to user
 * 3. USDC stored for future redemptions
 *
 * UC Redemption Flow:
 * 1. Member calls redeem(amount) with UC approval
 * 2. Vault transfers UC from member to vault
 * 3. Vault emits RedeemRequested event with unique redemptionId
 * 4. Backend monitors events and processes redemption off-chain
 * 5. Backend can:
 *    - fulfillRedemption(): Send USDC to user, burn UC
 *    - cancelRedemption(): Cancel and refund UC (user must still be active member)
 *    - forfeitRedemption(): Cancel without refund (for fraud/violations)
 *
 * Redemption Outcomes:
 * - Fulfilled: USDC sent to user, UC burned (deflationary)
 * - Cancelled: UC returned to user (user must be active member)
 * - Forfeited: No refund, UC burned (deflationary, used for fraud/violations)
 *
 * Roles:
 * - BACKEND: Backend that processes redemptions (fulfills, cancels, or forfeits)
 * - TREASURER: Can withdraw UC from vault (Treasury Safe)
 * - DEFAULT_ADMIN: Can grant/revoke roles
 */
contract RedemptionVault is AccessControlEnumerable, ReentrancyGuard {
    // Role definitions
    bytes32 public constant BACKEND = keccak256("BACKEND");
    bytes32 public constant TREASURER = keccak256("TREASURER");

    // Token references
    IERC20 public immutable unityCoin;
    IERC20 public immutable usdc;

    // Redemption status enum
    enum RedemptionStatus {
        Pending, // Waiting for processing
        Fulfilled, // Completed successfully
        Cancelled, // Cancelled (UC returned to user)
        Forfeited // Cancelled and forfeited (UC kept by vault/treasury)
    }

    // Redemption request struct
    struct RedemptionRequest {
        address user;
        uint256 amount;
        uint256 timestamp;
        RedemptionStatus status;
    }

    // Mapping from redemptionId to request
    mapping(bytes32 => RedemptionRequest) public redemptions;

    // Redemption limits (0 = unlimited)
    uint256 public maxRedemptionPerUser = 0; // Maximum redemption per user per request (0 = unlimited)
    uint256 public maxDailyRedemptions = 0; // Maximum total redemptions per day (0 = unlimited)

    // Track daily redemption totals
    mapping(uint256 => uint256) public dailyRedemptionTotal; // day => total amount redeemed

    // USDC reserve tracking
    uint256 public totalUSDCReserve;

    // Multi-coop foundation (minimal)
    uint256 public coopId = 1; // Default Cahootz co-op id
    address public clearingContract = address(0); // Future cross-coop clearing

    // Events
    event RedeemRequested(address indexed user, uint256 amount, bytes32 indexed redemptionId, uint256 timestamp);

    event RedemptionFulfilled(
        bytes32 indexed redemptionId,
        address indexed user,
        uint256 amount,
        address indexed processor
    );

    event RedemptionCancelled(
        bytes32 indexed redemptionId,
        address indexed user,
        uint256 amount,
        address indexed processor
    );

    event RedemptionForfeited(
        bytes32 indexed redemptionId,
        address indexed user,
        uint256 amount,
        address indexed processor,
        string reason
    );

    event TreasuryWithdrawal(address indexed treasurer, uint256 amount, address indexed destination);

    event MaxRedemptionPerUserChanged(uint256 oldLimit, uint256 newLimit, address indexed changedBy);

    event MaxDailyRedemptionsChanged(uint256 oldLimit, uint256 newLimit, address indexed changedBy);

    event OwnershipTransferInitiated(address indexed from, address indexed to, uint256 timestamp);

    event OwnershipTransferCompleted(address indexed from, uint256 timestamp);

    // USDC onboarding events
    event USDCOnboardingProcessed(address indexed user, uint256 usdcAmount, uint256 ucAmount, address indexed processedBy);
    event USDCWithdrawn(address indexed to, uint256 amount, address indexed withdrawnBy);

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
    event CrossCoopRedemption(uint256 indexed fromCoopId, uint256 indexed toCoopId, address indexed member, uint256 amount);

    /**
     * @notice Constructor
     * @param _unityCoin Address of the UnityCoin (UC) contract
     * @param _usdc Address of the USDC contract
     * @param admin Address that will have admin role
     */
    constructor(address _unityCoin, address _usdc, address admin) {
        require(_unityCoin != address(0), "UC cannot be zero address");
        require(_usdc != address(0), "USDC cannot be zero address");
        require(admin != address(0), "Admin cannot be zero address");

        unityCoin = IERC20(_unityCoin);
        usdc = IERC20(_usdc);

        // Grant admin role
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // Admin starts with processing roles
        _grantRole(BACKEND, admin);
        _grantRole(TREASURER, admin);
    }

    // ========== USDC ONBOARDING ==========

    /**
     * @notice Process USDC onboarding - convert USDC to UC
     * @param usdcAmount Amount of USDC to deposit (6 decimals)
     * @dev User must approve this contract to spend USDC first
     * @dev Mints UC to user based on 1:1 exchange rate
     */
    function processUSDCOnboarding(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount > 0, "Amount must be greater than 0");

        // Transfer USDC from user to this contract
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");

        // Update USDC reserve
        totalUSDCReserve += usdcAmount;

        // Mint UC to user (1:1 exchange rate)
        // Convert USDC amount (6 decimals) to UC amount (18 decimals)
        uint256 ucAmount = usdcAmount * 1e12; // Convert from 6 to 18 decimals
        // Note: This requires the vault to have TREASURER_MINT role in UnityCoin
        UnityCoin(address(unityCoin)).mint(msg.sender, ucAmount);

        emit USDCOnboardingProcessed(msg.sender, usdcAmount, ucAmount, msg.sender);
    }

    /**
     * @notice Get current USDC balance of vault
     * @return uint256 Current USDC balance (6 decimals)
     */
    function getUSDCBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Withdraw USDC from vault (admin function)
     * @param to Address to send USDC to
     * @param amount Amount of USDC to withdraw (6 decimals)
     * @dev Only callable by TREASURER role
     */
    function withdrawUSDC(address to, uint256 amount) external onlyRole(TREASURER) nonReentrant {
        require(to != address(0), "Cannot withdraw to zero address");
        require(amount > 0, "Amount must be greater than 0");
        require(usdc.balanceOf(address(this)) >= amount, "Insufficient USDC balance");

        // Update total reserve
        totalUSDCReserve -= amount;

        // Transfer USDC
        require(usdc.transfer(to, amount), "USDC transfer failed");

        emit USDCWithdrawn(to, amount, msg.sender);
    }

    /**
     * @notice Update USDC reserve to match actual balance (admin function)
     * @dev Only callable by TREASURER role
     * @dev Use this when USDC is sent directly to the vault
     */
    function updateUSDCReserve() external onlyRole(TREASURER) {
        totalUSDCReserve = usdc.balanceOf(address(this));
    }

    // ========== UC REDEMPTION ==========

    /**
     * @notice Request redemption of UC for USDC
     * @param amount Amount of UC to redeem
     * @dev User must approve vault to spend UC first
     */
    function redeem(uint256 amount) external nonReentrant returns (bytes32) {
        require(amount > 0, "Amount must be greater than 0");

        // Check per-user redemption limit if set (0 = unlimited)
        if (maxRedemptionPerUser > 0) {
            require(amount <= maxRedemptionPerUser, "Amount exceeds max redemption per user");
        }

        // Check daily redemption limit if set (0 = unlimited)
        if (maxDailyRedemptions > 0) {
            uint256 today = block.timestamp / 1 days;
            require(dailyRedemptionTotal[today] + amount <= maxDailyRedemptions, "Daily redemption limit exceeded");
            dailyRedemptionTotal[today] += amount;
        }

        // Generate unique redemption ID
        bytes32 redemptionId = keccak256(abi.encodePacked(msg.sender, amount, block.timestamp, block.number));

        // Ensure redemption ID is unique
        require(redemptions[redemptionId].user == address(0), "Redemption ID collision");

        // Transfer UC from user to vault
        require(unityCoin.transferFrom(msg.sender, address(this), amount), "UC transfer failed");

        // Store redemption request
        redemptions[redemptionId] = RedemptionRequest({
            user: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            status: RedemptionStatus.Pending
        });

        emit RedeemRequested(msg.sender, amount, redemptionId, block.timestamp);

        return redemptionId;
    }

    /**
     * @notice Mark redemption as fulfilled - send USDC to user and burn UC
     * @param redemptionId ID of the redemption request
     * @dev Only callable by BACKEND role (backend)
     * @dev Sends USDC to user and burns UC (deflationary)
     */
    function fulfillRedemption(bytes32 redemptionId) external onlyRole(BACKEND) {
        RedemptionRequest storage request = redemptions[redemptionId];
        require(request.user != address(0), "Redemption not found");
        require(request.status == RedemptionStatus.Pending, "Redemption not pending");

        request.status = RedemptionStatus.Fulfilled;

        // Send USDC to user (1:1 exchange rate)
        // Convert UC amount (18 decimals) to USDC amount (6 decimals)
        uint256 usdcAmount = request.amount / 1e12; // Convert from 18 to 6 decimals
        require(usdcAmount > 0, "USDC amount too small");
        require(usdc.balanceOf(address(this)) >= usdcAmount, "Insufficient USDC balance");
        require(totalUSDCReserve >= usdcAmount, "Insufficient USDC reserve");
        
        require(usdc.transfer(request.user, usdcAmount), "USDC transfer failed");
        
        // Update USDC reserve (both are in 6 decimals)
        totalUSDCReserve -= usdcAmount;

        // Burn the UC to reduce total supply (deflationary)
        UnityCoin(address(unityCoin)).burn(request.amount);

        emit RedemptionFulfilled(redemptionId, request.user, request.amount, msg.sender);
    }

    /**
     * @notice Cancel redemption and return UC to user
     * @param redemptionId ID of the redemption request
     * @dev Only callable by BACKEND role (backend)
     * @dev Use this for legitimate cancellations (technical issues, user still in good standing)
     * @dev User must still be an active member to receive refund
     */
    function cancelRedemption(bytes32 redemptionId) external onlyRole(BACKEND) nonReentrant {
        RedemptionRequest storage request = redemptions[redemptionId];
        require(request.user != address(0), "Redemption not found");
        require(request.status == RedemptionStatus.Pending, "Redemption not pending");

        request.status = RedemptionStatus.Cancelled;

        // Return UC to user (will fail if user is suspended/banned)
        require(unityCoin.transfer(request.user, request.amount), "UC return failed");

        emit RedemptionCancelled(redemptionId, request.user, request.amount, msg.sender);
    }

    /**
     * @notice Forfeit redemption (no refund, UC burned)
     * @param redemptionId ID of the redemption request
     * @param reason Reason for forfeiture (e.g., "Fraud detected", "Terms violation")
     * @dev Only callable by BACKEND role (backend)
     * @dev Use this when user is suspended/banned or violated terms
     * @dev Burns UC to reduce total supply (deflationary)
     */
    function forfeitRedemption(bytes32 redemptionId, string calldata reason) external onlyRole(BACKEND) {
        RedemptionRequest storage request = redemptions[redemptionId];
        require(request.user != address(0), "Redemption not found");
        require(request.status == RedemptionStatus.Pending, "Redemption not pending");

        request.status = RedemptionStatus.Forfeited;

        // Burn the UC to reduce total supply (deflationary)
        UnityCoin(address(unityCoin)).burn(request.amount);

        emit RedemptionForfeited(redemptionId, request.user, request.amount, msg.sender, reason);
    }

    /**
     * @notice Mark redemption as resolved after emergency transfer
     * @param redemptionId ID of the redemption request
     * @param reason Reason for emergency resolution
     * @dev Only callable by TREASURER role (requires elevated privileges)
     * @dev Use this after admin manually handles redemption via UnityCoin.emergencyTransfer()
     * @dev Does NOT move UC - just updates status (UC already moved via emergencyTransfer)
     */
    function markEmergencyResolved(bytes32 redemptionId, string calldata reason) external onlyRole(TREASURER) {
        RedemptionRequest storage request = redemptions[redemptionId];
        require(request.user != address(0), "Redemption not found");
        require(
            request.status == RedemptionStatus.Pending || request.status == RedemptionStatus.Forfeited,
            "Cannot resolve this redemption"
        );

        request.status = RedemptionStatus.Cancelled;

        // UC already moved via emergencyTransfer - just update status
        emit RedemptionCancelled(redemptionId, request.user, request.amount, msg.sender);

        // Track emergency resolution
        emit RedemptionForfeited(
            redemptionId,
            request.user,
            request.amount,
            msg.sender,
            string(abi.encodePacked("EMERGENCY_RESOLVED: ", reason))
        );
    }

    /**
     * @notice Withdraw UC from vault to treasury
     * @param amount Amount of UC to withdraw
     * @param destination Address to send UC to (typically Treasury Safe)
     * @dev Only callable by TREASURER role
     */
    function withdrawToTreasury(uint256 amount, address destination) external onlyRole(TREASURER) nonReentrant {
        require(destination != address(0), "Destination cannot be zero address");
        require(amount > 0, "Amount must be greater than 0");
        require(unityCoin.balanceOf(address(this)) >= amount, "Insufficient vault balance");

        require(unityCoin.transfer(destination, amount), "UC transfer failed");

        emit TreasuryWithdrawal(msg.sender, amount, destination);
    }

    /**
     * @notice Get vault's UC balance
     * @return uint256 Current UC balance
     */
    function getVaultBalance() external view returns (uint256) {
        return unityCoin.balanceOf(address(this));
    }

    /**
     * @notice Get redemption request details
     * @param redemptionId ID of the redemption
     * @return RedemptionRequest struct with request details
     */
    function getRedemption(bytes32 redemptionId) external view returns (RedemptionRequest memory) {
        return redemptions[redemptionId];
    }

    // ========== ADMIN FUNCTIONS ==========

    /**
     * @notice Set the maximum redemption amount per user per request
     * @param newLimit New maximum redemption limit (0 = unlimited)
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe)
     */
    function setMaxRedemptionPerUser(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = maxRedemptionPerUser;
        maxRedemptionPerUser = newLimit;
        emit MaxRedemptionPerUserChanged(oldLimit, newLimit, msg.sender);
    }

    /**
     * @notice Set the maximum total redemptions per day
     * @param newLimit New maximum daily redemption limit (0 = unlimited)
     * @dev Only callable by DEFAULT_ADMIN_ROLE (Treasury Safe)
     */
    function setMaxDailyRedemptions(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = maxDailyRedemptions;
        maxDailyRedemptions = newLimit;
        emit MaxDailyRedemptionsChanged(oldLimit, newLimit, msg.sender);
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
}
