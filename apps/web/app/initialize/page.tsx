"use client";

import { useState, useEffect } from "react";
import { useAccount, useWalletClient, usePublicClient, useSwitchChain } from "wagmi";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import type { Hash } from "viem";
import { baseSepolia, base } from "viem/chains";
import { createPublicClient, http } from "viem";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { DeploymentStep, ContractCard } from "@/components/deployment-status";
import { CoopConfigPreview } from "@/components/config-preview";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/trpc/client";
import { env } from "~/env";

interface DeploymentStepType {
  id: string;
  name: string;
  description: string;
  status: "pending" | "deploying" | "completed" | "failed";
  txHash?: Hash;
  contractAddress?: string;
  error?: string;
}

interface DeployedContracts {
  unityCoin?: string;
  soulaaniCoin?: string;
  allyCoin?: string;
  redemptionVault?: string;
  verifiedStoreRegistry?: string;
  scRewardEngine?: string;
  storePaymentRouter?: string;
};

export default function InitializePage() {
  const { address, isConnected, chain: connectedChain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { open } = useWeb3Modal();
  const { switchChain } = useSwitchChain();

  // tRPC mutation for saving co-op config (includes chain config)
  const createCoopConfig = api.coopConfig.create.useMutation();

  // API connection check
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string>("");

  const [currentPhase, setCurrentPhase] = useState<"config" | "deploy" | "complete">("config");
  const [network, setNetwork] = useState<"baseSepolia" | "base">("baseSepolia");
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [customRpcUrl, setCustomRpcUrl] = useState("");

  // Check API connection on mount
  useEffect(() => {
    async function checkApiConnection() {
      const apiUrl = env.NEXT_PUBLIC_API_URL;
      
      if (!apiUrl) {
        setApiConnected(false);
        setApiError("NEXT_PUBLIC_API_URL not configured");
        console.error("❌ NEXT_PUBLIC_API_URL environment variable not set");
        return;
      }

      try {
        console.log("🔍 Checking API connection to:", apiUrl);
        const response = await fetch(`${apiUrl}/health.ping`);
        
        if (response.ok) {
          const data = await response.json();
          if (data?.result?.data?.status === "ok") {
            setApiConnected(true);
            console.log("✅ API connection successful");
          } else {
            setApiConnected(false);
            setApiError("Invalid API response");
            console.error("❌ Invalid API response:", data);
          }
        } else {
          setApiConnected(false);
          setApiError(`API returned status ${response.status}`);
          console.error(`❌ API returned status ${response.status}`);
        }
      } catch (error) {
        setApiConnected(false);
        setApiError(error instanceof Error ? error.message : "Connection failed");
        console.error("❌ API connection failed:", error);
      }
    }

    checkApiConnection();
  }, []);

  // Load saved RPC URL from localStorage on mount
  useEffect(() => {
    const savedRpcUrl = localStorage.getItem("soulaan_custom_rpc_url");
    if (savedRpcUrl) {
      setCustomRpcUrl(savedRpcUrl);
    }
  }, []);

  // Save RPC URL to localStorage when it changes
  useEffect(() => {
    if (customRpcUrl) {
      localStorage.setItem("soulaan_custom_rpc_url", customRpcUrl);
    } else {
      localStorage.removeItem("soulaan_custom_rpc_url");
    }
  }, [customRpcUrl]);
  
  // Optional contracts selection
  const [optionalContracts, setOptionalContracts] = useState({
    redemptionVault: false,
    verifiedStoreRegistry: false,
    scRewardEngine: false,
    storePaymentRouter: false,
  });
  
  // Co-op Configuration
  const [coopConfig, setCoopConfig] = useState({
    name: "",
    shortName: "",
    tagline: "",
    description: "",
    treasuryAddress: "",
    governanceBotAddress: "",
    primaryColor: "#2563eb",
    accentColor: "#16a34a",
    
    // Token branding
    scTokenName: "SoulCoin",
    scTokenSymbol: "SC",
    
    // Governance
    quorumPercent: 15,
    approvalThresholdPercent: 51,
    votingWindowDays: 7,
    screeningPassThreshold: 0.6,
    
    // Payment settings
    minPaymentAmount: 0.01,
    maxPaymentAmount: 10000,
    claimExpirationDays: 7,
    withdrawalMinAmount: 1,
    
    // Fees
    p2pFeePercent: 0,
    withdrawalFeePercent: 0,
    withdrawalFeeFlat: 0,
  });

  const getDeploymentSteps = (): DeploymentStepType[] => {
    const tokenName = coopConfig.scTokenName.trim() || "SoulaaniCoin";
    const tokenSymbol = coopConfig.scTokenSymbol.trim() || "SC";
    const steps: DeploymentStepType[] = [
      { id: "sc", name: `Deploy ${tokenName}`, description: `Governance token (${tokenSymbol}) - REQUIRED`, status: "pending" },
      { id: "ally", name: "Deploy AllyCoin", description: "Cross-coop membership token (REQUIRED)", status: "pending" },
      { id: "uc", name: "Deploy UnityCoin", description: "Main payment currency (REQUIRED)", status: "pending" },
    ];

    if (optionalContracts.redemptionVault) {
      steps.push({ id: "vault", name: "Deploy RedemptionVault", description: "Handles UC redemptions (OPTIONAL)", status: "pending" });
    }
    if (optionalContracts.verifiedStoreRegistry) {
      steps.push({ id: "registry", name: "Deploy VerifiedStoreRegistry", description: "On-chain store verification (OPTIONAL)", status: "pending" });
    }
    if (optionalContracts.scRewardEngine) {
      steps.push({ id: "engine", name: "Deploy SCRewardEngine", description: "Reward calculation engine (OPTIONAL)", status: "pending" });
    }
    if (optionalContracts.storePaymentRouter) {
      steps.push({ id: "router", name: "Deploy StorePaymentRouter", description: "Payment routing system (OPTIONAL)", status: "pending" });
    }

    const needsRoles = optionalContracts.scRewardEngine || optionalContracts.storePaymentRouter;
    if (needsRoles) {
      steps.push({ id: "roles", name: "Grant Roles", description: "Set up permissions", status: "pending" });
    }

    // Always add member initialization and database save steps
    steps.push({ id: "init-member", name: "Initialize Admin", description: "Register deployer as member & mint initial SC", status: "pending" });
    steps.push({ id: "save-db", name: "Save to Database", description: "Register co-op in system", status: "pending" });

    return steps;
  };

  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStepType[]>(getDeploymentSteps());

  const [deployedContracts, setDeployedContracts] = useState<DeployedContracts>({});

  // Check if wallet is on the correct network
  useEffect(() => {
    if (!connectedChain) {
      setIsWrongNetwork(false);
      return;
    }

    const expectedChainId = network === "baseSepolia" ? 84532 : 8453;
    setIsWrongNetwork(connectedChain.id !== expectedChainId);
  }, [connectedChain, network]);

  // Handle network switch
  const handleSwitchNetwork = () => {
    if (!switchChain) {
      alert("Network switching is not supported by your wallet. Please manually switch networks in your wallet.");
      return;
    }
    
    setIsSwitchingNetwork(true);
    
    try {
      const targetChain = network === "baseSepolia" ? baseSepolia : base;
      console.log(`Attempting to switch to ${targetChain.name} (Chain ID: ${targetChain.id})`);
      
      switchChain(
        { chainId: targetChain.id },
        {
          onSuccess: () => {
            console.log("✅ Network switch successful");
            setIsSwitchingNetwork(false);
          },
          onError: (error: any) => {
            console.error("Failed to switch network:", error);
            
            // User rejected the request
            if (error.code === 4001 || error.message?.includes("User rejected")) {
              alert("Network switch cancelled. Please approve the network switch in your wallet.");
            } else {
              alert(`Failed to switch network: ${error.message || "Unknown error"}. Please manually switch to ${network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"} in your wallet.`);
            }
            setIsSwitchingNetwork(false);
          },
        }
      );
    } catch (error: any) {
      console.error("Failed to switch network:", error);
      alert(`Failed to switch network: ${error.message || "Unknown error"}. Please manually switch to ${network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"} in your wallet.`);
      setIsSwitchingNetwork(false);
    }
  };

  const updateStepStatus = (
    stepId: string,
    status: DeploymentStepType["status"],
    data?: { txHash?: Hash; contractAddress?: string; error?: string }
  ) => {
    setDeploymentSteps((prev) =>
      prev.map((step) =>
        step.id === stepId ? { ...step, status, ...data } : step
      )
    );
  };

  const deployContracts = async () => {
    console.log("🚀 Deploy button clicked");
    console.log("Wallet client:", !!walletClient);
    console.log("Public client:", !!publicClient);
    console.log("Address:", address);
    
    if (!walletClient || !address) {
      alert("Please connect your wallet first");
      return;
    }

    // Check if on correct network
    const expectedChainId = network === "baseSepolia" ? 84532 : 8453;
    if (connectedChain?.id !== expectedChainId) {
      alert(`Please switch your wallet to ${network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"} (Chain ID: ${expectedChainId})`);
      return;
    }

    console.log("✅ Starting deployment...");
    setDeploymentSteps(getDeploymentSteps());
    setCurrentPhase("deploy");

    try {
      const selectedChain = network === "baseSepolia" ? baseSepolia : base;
      
      // Always create an explicit public client so receipt polling is never undefined.
      // If the user supplied a custom RPC (e.g. Alchemy/QuickNode), use it for both
      // deployment reads AND receipt polling — it's more reliable than wagmi's default
      // publicClient which can be undefined when the wallet is on a different network.
      const rpcUrl =
        customRpcUrl ||
        (network === "base"
          ? base.rpcUrls.default.http[0]
          : baseSepolia.rpcUrls.default.http[0]);

      const deployPublicClient = createPublicClient({
        chain: selectedChain,
        transport: http(rpcUrl),
      });

      // Use the same reliable RPC for receipt polling (avoids the optional-chaining
      // silent-skip bug where wagmi's publicClient could be undefined)
      const receiptClient = deployPublicClient;
      
      console.log("Using RPC:", rpcUrl);
      console.log("Network:", selectedChain.name, "Chain ID:", selectedChain.id);
      
      // Import required contract artifacts
      const soulaaniCoinArtifact = await import("@/lib/contracts/SoulaaniCoin.json");
      const allyCoinArtifact = await import("@/lib/contracts/AllyCoin.json");
      const unityCoinArtifact = await import("@/lib/contracts/UnityCoin.json");

      const treasuryAddress = (coopConfig.treasuryAddress || address) as `0x${string}`;
      const governanceBotAddress = (coopConfig.governanceBotAddress || address) as `0x${string}`;

      // Declare contract addresses at function scope
      let soulaaniCoinAddress: `0x${string}`;
      let allyCoinAddress: `0x${string}`;
      let unityCoinAddress: `0x${string}`;

      // Step 1: Deploy SoulaaniCoin
      try {
        console.log("📝 Step 1: Deploying SoulaaniCoin...");
        updateStepStatus("sc", "deploying");
        console.log("Governance bot address:", governanceBotAddress);
        console.log("Chain:", selectedChain.name, "ID:", selectedChain.id);
        
        const scHash = await walletClient.deployContract({
          abi: soulaaniCoinArtifact.abi,
          bytecode: soulaaniCoinArtifact.bytecode as `0x${string}`,
          args: [governanceBotAddress],
          chain: selectedChain,
        });
        console.log("✅ SoulaaniCoin deployment tx sent:", scHash);
        updateStepStatus("sc", "deploying", { txHash: scHash });
        
        console.log("⏳ Waiting for SoulaaniCoin deployment receipt...");
        const scReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: scHash });
        soulaaniCoinAddress = scReceipt.contractAddress!;
        console.log("✅ SoulaaniCoin deployed at:", soulaaniCoinAddress);
        updateStepStatus("sc", "completed", { txHash: scHash, contractAddress: soulaaniCoinAddress });
        setDeployedContracts((prev) => ({ ...prev, soulaaniCoin: soulaaniCoinAddress }));
      } catch (scError: any) {
        console.error("❌ SoulaaniCoin deployment failed:", scError);
        console.error("Error details:", {
          message: scError.message,
          code: scError.code,
          data: scError.data,
        });
        throw new Error(`SoulaaniCoin deployment failed: ${scError.message || scError.toString()}`);
      }

      // Step 2: Deploy AllyCoin
      try {
        console.log("📝 Step 2: Deploying AllyCoin...");
        updateStepStatus("ally", "deploying");
        console.log("Args:", { governanceBotAddress, soulaaniCoinAddress });
        
        const allyHash = await walletClient.deployContract({
          abi: allyCoinArtifact.abi,
          bytecode: allyCoinArtifact.bytecode as `0x${string}`,
          args: [governanceBotAddress, soulaaniCoinAddress],
          chain: selectedChain,
        });
        console.log("✅ AllyCoin deployment tx sent:", allyHash);
        updateStepStatus("ally", "deploying", { txHash: allyHash });
        
        console.log("⏳ Waiting for AllyCoin deployment receipt...");
        const allyReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: allyHash });
        allyCoinAddress = allyReceipt.contractAddress!;
        console.log("✅ AllyCoin deployed at:", allyCoinAddress);
        updateStepStatus("ally", "completed", { txHash: allyHash, contractAddress: allyCoinAddress });
        setDeployedContracts((prev) => ({ ...prev, allyCoin: allyCoinAddress }));

        // Link AllyCoin to SoulaaniCoin
        console.log("🔗 Linking AllyCoin to SoulaaniCoin...");
        const linkHash = await walletClient.writeContract({
          address: soulaaniCoinAddress,
          abi: soulaaniCoinArtifact.abi,
          functionName: "setAllyCoin",
          args: [allyCoinAddress, "Initial deployment - linking AllyCoin"],
          chain: selectedChain,
        });
        console.log("⏳ Waiting for link transaction...");
        await deployPublicClient.waitForTransactionReceipt({ hash: linkHash });
        console.log("✅ AllyCoin linked to SoulaaniCoin");
      } catch (allyError: any) {
        console.error("❌ AllyCoin deployment failed:", allyError);
        console.error("Error details:", {
          message: allyError.message,
          code: allyError.code,
          data: allyError.data,
        });
        throw new Error(`AllyCoin deployment failed: ${allyError.message || allyError.toString()}`);
      }

      // Step 3: Deploy UnityCoin
      try {
        console.log("📝 Step 3: Deploying UnityCoin...");
        updateStepStatus("uc", "deploying");
        console.log("Args:", { treasuryAddress, soulaaniCoinAddress, memberManager: address });
        
        const ucHash = await walletClient.deployContract({
          abi: unityCoinArtifact.abi,
          bytecode: unityCoinArtifact.bytecode as `0x${string}`,
          args: [treasuryAddress, soulaaniCoinAddress, address],
          chain: selectedChain,
        });
        console.log("✅ UnityCoin deployment tx sent:", ucHash);
        updateStepStatus("uc", "deploying", { txHash: ucHash });
        
        console.log("⏳ Waiting for UnityCoin deployment receipt...");
        const ucReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: ucHash });
        unityCoinAddress = ucReceipt.contractAddress!;
        console.log("✅ UnityCoin deployed at:", unityCoinAddress);
        updateStepStatus("uc", "completed", { txHash: ucHash, contractAddress: unityCoinAddress });
        setDeployedContracts((prev) => ({ ...prev, unityCoin: unityCoinAddress }));
      } catch (ucError: any) {
        console.error("❌ UnityCoin deployment failed:", ucError);
        console.error("Error details:", {
          message: ucError.message,
          code: ucError.code,
          data: ucError.data,
        });
        throw new Error(`UnityCoin deployment failed: ${ucError.message || ucError.toString()}`);
      }

      let redemptionVaultAddress: string | undefined;
      let verifiedStoreRegistryAddress: string | undefined;
      let scRewardEngineAddress: string | undefined;
      let storePaymentRouterAddress: string | undefined;

      // Step 4: Deploy RedemptionVault (Optional)
      if (optionalContracts.redemptionVault) {
        const redemptionVaultArtifact = await import("@/lib/contracts/RedemptionVault.json");
        updateStepStatus("vault", "deploying");
        const vaultHash = await walletClient.deployContract({
          abi: redemptionVaultArtifact.abi,
          bytecode: redemptionVaultArtifact.bytecode as `0x${string}`,
          args: [unityCoinAddress, treasuryAddress],
          chain: selectedChain,
        });
        updateStepStatus("vault", "deploying", { txHash: vaultHash });
        
        const vaultReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: vaultHash });
        redemptionVaultAddress = vaultReceipt.contractAddress!;
        updateStepStatus("vault", "completed", { txHash: vaultHash, contractAddress: redemptionVaultAddress });
        setDeployedContracts((prev) => ({ ...prev, redemptionVault: redemptionVaultAddress }));
      }

      // Step 5: Deploy VerifiedStoreRegistry (Optional)
      if (optionalContracts.verifiedStoreRegistry) {
        const verifiedStoreRegistryArtifact = await import("@/lib/contracts/VerifiedStoreRegistry.json");
        updateStepStatus("registry", "deploying");
        const registryHash = await walletClient.deployContract({
          abi: verifiedStoreRegistryArtifact.abi,
          bytecode: verifiedStoreRegistryArtifact.bytecode as `0x${string}`,
          args: [treasuryAddress],
          chain: selectedChain,
        });
        updateStepStatus("registry", "deploying", { txHash: registryHash });
        
        const registryReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: registryHash });
        verifiedStoreRegistryAddress = registryReceipt.contractAddress!;
        updateStepStatus("registry", "completed", { txHash: registryHash, contractAddress: verifiedStoreRegistryAddress });
        setDeployedContracts((prev) => ({ ...prev, verifiedStoreRegistry: verifiedStoreRegistryAddress }));
      }

      // Step 6: Deploy SCRewardEngine (Optional, requires registry)
      if (optionalContracts.scRewardEngine && verifiedStoreRegistryAddress) {
        const scRewardEngineArtifact = await import("@/lib/contracts/SCRewardEngine.json");
        updateStepStatus("engine", "deploying");
        const engineHash = await walletClient.deployContract({
          abi: scRewardEngineArtifact.abi,
          bytecode: scRewardEngineArtifact.bytecode as `0x${string}`,
          args: [treasuryAddress, soulaaniCoinAddress, verifiedStoreRegistryAddress],
          chain: selectedChain,
        });
        updateStepStatus("engine", "deploying", { txHash: engineHash });
        
        const engineReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: engineHash });
        scRewardEngineAddress = engineReceipt.contractAddress!;
        updateStepStatus("engine", "completed", { txHash: engineHash, contractAddress: scRewardEngineAddress });
        setDeployedContracts((prev) => ({ ...prev, scRewardEngine: scRewardEngineAddress }));
      }

      // Step 6: Deploy StorePaymentRouter (Optional, requires registry and engine)
      if (optionalContracts.storePaymentRouter && verifiedStoreRegistryAddress && scRewardEngineAddress) {
        const storePaymentRouterArtifact = await import("@/lib/contracts/StorePaymentRouter.json");
        updateStepStatus("router", "deploying");
        const routerHash = await walletClient.deployContract({
          abi: storePaymentRouterArtifact.abi,
          bytecode: storePaymentRouterArtifact.bytecode as `0x${string}`,
          args: [treasuryAddress, unityCoinAddress, verifiedStoreRegistryAddress, scRewardEngineAddress as `0x${string}`],
          chain: selectedChain,
        });
        updateStepStatus("router", "deploying", { txHash: routerHash });
        
        const routerReceipt = await deployPublicClient.waitForTransactionReceipt({ hash: routerHash });
        storePaymentRouterAddress = routerReceipt.contractAddress!;
        updateStepStatus("router", "completed", { txHash: routerHash, contractAddress: storePaymentRouterAddress });
        setDeployedContracts((prev) => ({ ...prev, storePaymentRouter: storePaymentRouterAddress }));
      }

      // Step 8: Grant Roles (Only if needed)
      if (scRewardEngineAddress || storePaymentRouterAddress) {
        updateStepStatus("roles", "deploying");
        
        // Grant GOVERNANCE_AWARD role to SCRewardEngine on SoulaaniCoin
        if (scRewardEngineAddress) {
          const GOVERNANCE_AWARD = "0x" + Buffer.from("GOVERNANCE_AWARD").toString("hex");
          const grantAwardHash = await walletClient.writeContract({
            address: soulaaniCoinAddress,
            abi: soulaaniCoinArtifact.abi,
            functionName: "grantRole",
            args: [GOVERNANCE_AWARD, scRewardEngineAddress as `0x${string}`],
            chain: selectedChain,
          });
          await deployPublicClient.waitForTransactionReceipt({ hash: grantAwardHash });
        }

        // Grant REWARD_EXECUTOR role to StorePaymentRouter on SCRewardEngine
        if (storePaymentRouterAddress && scRewardEngineAddress) {
          const scRewardEngineArtifact = await import("@/lib/contracts/SCRewardEngine.json");
          const REWARD_EXECUTOR = "0x" + Buffer.from("REWARD_EXECUTOR").toString("hex");
          const grantExecutorHash = await walletClient.writeContract({
            address: scRewardEngineAddress as `0x${string}`,
            abi: scRewardEngineArtifact.abi,
            functionName: "grantRole",
            args: [REWARD_EXECUTOR, storePaymentRouterAddress],
            chain: selectedChain,
          });
          await deployPublicClient.waitForTransactionReceipt({ hash: grantExecutorHash });
        }

        updateStepStatus("roles", "completed");
      }

      // Step 9: Initialize Deployer as Member with SC tokens
      try {
        console.log("📝 Step 9: Registering deployer as member and minting initial SC...");
        console.log("   Network:", selectedChain.name, "Chain ID:", selectedChain.id);
        console.log("   SC Address:", soulaaniCoinAddress);
        console.log("   Deployer Address:", address);
        
        // Verify wallet is on correct network
        const walletChainId = await walletClient.getChainId();
        console.log("   Wallet Chain ID:", walletChainId);
        
        if (walletChainId !== selectedChain.id) {
          throw new Error(`Wallet is on wrong network! Expected ${selectedChain.id}, got ${walletChainId}. Please switch networks in your wallet.`);
        }
        
        updateStepStatus("init-member", "deploying");
        
        // Wait for contract to be indexed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if deployer is already a member
        let deployerStatus;
        try {
          deployerStatus = await deployPublicClient.readContract({
            address: soulaaniCoinAddress,
            abi: soulaaniCoinArtifact.abi,
            functionName: "memberStatus",
            args: [address],
          });
        } catch (error) {
          console.log("⚠️  Could not read member status, assuming NotMember");
          deployerStatus = 0; // NotMember = 0
        }
        
        // Add deployer as an active member if not already
        // Use Number() comparison since viem returns uint8 enum as a number, not BigInt
        if (Number(deployerStatus) === 0) {
          console.log("Adding deployer as member...");
          const addMemberHash = await walletClient.writeContract({
            address: soulaaniCoinAddress,
            abi: soulaaniCoinArtifact.abi,
            functionName: "addMember",
            args: [address],
            chain: selectedChain,
          });
          console.log("✅ Add member tx sent:", addMemberHash);
          console.log(`   View on BaseScan: https://basescan.org/tx/${addMemberHash}`);
          
          const addMemberReceipt = await receiptClient.waitForTransactionReceipt({ 
            hash: addMemberHash,
            timeout: 180_000,
            pollingInterval: 2_000,
          });
          console.log("✅ Add member receipt:", addMemberReceipt);
          
          if (addMemberReceipt?.status === "reverted") {
            throw new Error("addMember transaction reverted");
          }
          
          console.log("✅ Deployer registered as active member");
        } else {
          console.log("✅ Deployer already a member (status:", deployerStatus, ")");
        }
        
        // Check if deployer has GOVERNANCE_AWARD role (needed to mint)
        console.log("Checking if deployer has GOVERNANCE_AWARD role...");
        const { keccak256: keccak256Role, toBytes: toBytesRole } = await import("viem");
        const GOVERNANCE_AWARD_ROLE = keccak256Role(toBytesRole("GOVERNANCE_AWARD"));
        
        let hasAwardRole;
        try {
          hasAwardRole = await deployPublicClient.readContract({
            address: soulaaniCoinAddress,
            abi: soulaaniCoinArtifact.abi,
            functionName: "hasRole",
            args: [GOVERNANCE_AWARD_ROLE, address],
          });
        } catch (error) {
          console.log("⚠️  Could not check role, assuming false");
          hasAwardRole = false;
        }
        
        console.log("   Deployer has GOVERNANCE_AWARD role:", hasAwardRole);
        
        // If deployer doesn't have the role, grant it (they should have DEFAULT_ADMIN_ROLE)
        if (!hasAwardRole) {
          console.log("⚠️  Deployer doesn't have GOVERNANCE_AWARD role, granting it...");
          try {
            const grantRoleHash = await walletClient.writeContract({
              address: soulaaniCoinAddress,
              abi: soulaaniCoinArtifact.abi,
              functionName: "grantRole",
              args: [GOVERNANCE_AWARD_ROLE, address],
              chain: selectedChain,
            });
            console.log("✅ Grant role tx sent:", grantRoleHash);
            await receiptClient.waitForTransactionReceipt({ 
              hash: grantRoleHash,
              timeout: 180_000,
              pollingInterval: 2_000,
            });
            console.log("✅ GOVERNANCE_AWARD role granted to deployer");
            
            // Wait for role to propagate and verify on network
            console.log("⏳ Verifying role propagation on network...");
            let roleVerified = false;
            for (let i = 0; i < 5; i++) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              try {
                const roleCheck = await deployPublicClient.readContract({
                  address: soulaaniCoinAddress,
                  abi: soulaaniCoinArtifact.abi,
                  functionName: "hasRole",
                  args: [GOVERNANCE_AWARD_ROLE, address],
                });
                if (roleCheck) {
                  roleVerified = true;
                  console.log("✅ Role verified on network");
                  break;
                }
              } catch (e) {
                console.log(`⏳ Waiting for role to propagate (attempt ${i + 1}/5)...`);
              }
            }
            
            if (!roleVerified) {
              throw new Error("Role grant succeeded but not visible on network after 15s - please wait and try again");
            }
          } catch (roleError: any) {
            console.error("❌ Failed to grant role:", roleError);
            throw new Error(`Cannot mint SC: deployer doesn't have GOVERNANCE_AWARD role and failed to grant it. Error: ${roleError.message}`);
          }
        }
        
        // Check if deployer already has SC tokens
        let deployerBalance;
        try {
          deployerBalance = await deployPublicClient.readContract({
            address: soulaaniCoinAddress,
            abi: soulaaniCoinArtifact.abi,
            functionName: "balanceOf",
            args: [address],
          });
        } catch (error) {
          console.log("⚠️  Could not read balance, assuming 0");
          deployerBalance = 0n;
        }
        
        // Mint initial SC tokens to deployer if they don't have any
        // 100,000 SC initial reserve to seed the total supply
        // This ensures the 2% hard cap = ~2,000 SC and rewards are whole numbers
        // uint256 IS returned as BigInt by viem, but use == for safety
        if (deployerBalance == 0n) {
          console.log("Minting 100,000 SC initial reserve to deployer...");
          const seedAmount = BigInt(100000) * BigInt(10 ** 18); // 100,000 SC tokens
          
          // Use keccak256 hash of the reason string (matching deployment script)
          const { keccak256, toBytes } = await import("viem");
          const reasonBytes32 = keccak256(toBytes("INITIAL_RESERVE_SEED"));
          
          console.log("Mint params:", {
            recipient: address,
            amount: seedAmount.toString(),
            reason: reasonBytes32,
            scAddress: soulaaniCoinAddress,
          });
          
          try {
            // Retry helper for mint operation with exponential backoff
            const mintWithRetry = async (maxRetries = 3): Promise<Hash> => {
              for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                  console.log(`⏳ Mint attempt ${attempt}/${maxRetries}...`);
                  
                  // Verify prerequisites right before minting
                  console.log("⏳ Verifying prerequisites before minting...");
                  const [finalMemberCheck, finalRoleCheck] = await Promise.all([
                    deployPublicClient.readContract({
                      address: soulaaniCoinAddress,
                      abi: soulaaniCoinArtifact.abi,
                      functionName: "isActiveMember",
                      args: [address],
                    }),
                    deployPublicClient.readContract({
                      address: soulaaniCoinAddress,
                      abi: soulaaniCoinArtifact.abi,
                      functionName: "hasRole",
                      args: [GOVERNANCE_AWARD_ROLE, address],
                    }),
                  ]);
                  
                  console.log("Pre-mint verification:", {
                    isActiveMember: finalMemberCheck,
                    hasGovernanceAward: finalRoleCheck,
                  });
                  
                  if (!finalMemberCheck) {
                    throw new Error("Deployer is not an active member - addMember may not have propagated yet");
                  }
                  if (!finalRoleCheck) {
                    throw new Error("Deployer does not have GOVERNANCE_AWARD role - grantRole may not have propagated yet");
                  }
                  
                  console.log("✅ Prerequisites verified");
                  
                  // Estimate gas using our reliable RPC (not wallet's potentially stale RPC)
                  console.log("⏳ Estimating gas for mint transaction...");
                  const gasEstimate = await deployPublicClient.estimateContractGas({
                    address: soulaaniCoinAddress,
                    abi: soulaaniCoinArtifact.abi,
                    functionName: "mintReward",
                    args: [address, seedAmount, reasonBytes32],
                    account: address,
                  });
                  
                  // Add 20% buffer for safety
                  const gasLimit = (gasEstimate * 120n) / 100n;
                  console.log(`✅ Gas estimated: ${gasEstimate.toString()} (using ${gasLimit.toString()} with 20% buffer)`);
                  
                  const mintHash = await walletClient.writeContract({
                    address: soulaaniCoinAddress,
                    abi: soulaaniCoinArtifact.abi,
                    functionName: "mintReward",
                    args: [address, seedAmount, reasonBytes32],
                    chain: selectedChain,
                    gas: gasLimit, // Override wallet's estimation with our reliable estimate
                  });
                  
                  return mintHash; // Success!
                } catch (error: any) {
                  const isLastAttempt = attempt === maxRetries;
                  const isGasError = error.message?.includes("gas") || 
                                    error.message?.includes("estimation") ||
                                    error.message?.includes("propagated");
                  
                  if (isLastAttempt || !isGasError) {
                    throw error; // Don't retry on last attempt or non-gas errors
                  }
                  
                  const delay = 5000 * attempt; // 5s, 10s, 15s
                  console.log(`⚠️ Mint failed (${error.message}), waiting ${delay/1000}s before retry...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
              throw new Error("Mint retry logic failed unexpectedly");
            };
            
            const mintHash = await mintWithRetry();
            console.log("✅ Mint reward tx sent:", mintHash);
            console.log(`   View on BaseScan: https://basescan.org/tx/${mintHash}`);
            
            // Check if transaction exists on the network immediately
            try {
              const txCheck = await receiptClient.getTransaction({ hash: mintHash });
              console.log("   Transaction found on network:", txCheck ? "YES" : "NO");
              if (txCheck) {
                console.log("   From:", txCheck.from);
                console.log("   To:", txCheck.to);
                console.log("   Nonce:", txCheck.nonce);
              }
            } catch (txCheckError) {
              console.log("   ⚠️  Could not verify transaction on network yet");
            }
            
            console.log("   Waiting for confirmation (this may take 30-60 seconds)...");
            
            try {
              // Use receiptClient (default public RPC) to avoid custom RPC sync issues
              const mintReceipt = await receiptClient.waitForTransactionReceipt({ 
                hash: mintHash,
                timeout: 180_000, // 3 minute timeout for mainnet
                pollingInterval: 2_000, // Check every 2 seconds
              });
              console.log("✅ Mint receipt received:", mintReceipt);
              console.log("   Status:", mintReceipt?.status);
              console.log("   Block:", mintReceipt?.blockNumber);
              console.log("   Gas used:", mintReceipt?.gasUsed.toString());
              
              if (mintReceipt?.status === "reverted") {
                throw new Error("mintReward transaction reverted - check if you have the GOVERNANCE_AWARD role");
              }
              
              console.log("✅ 100,000 SC initial reserve minted to deployer");
            } catch (receiptError: any) {
              console.error("❌ Error waiting for mint receipt:", receiptError);
              
              // If timeout, the transaction might still be pending
              if (receiptError.message?.includes("timeout") || receiptError.message?.includes("Timed out")) {
                console.log("⚠️  Transaction timed out waiting for confirmation");
                console.log("   The transaction may still be processing on the network");
                console.log(`   Check status at: https://basescan.org/tx/${mintHash}`);
                
                // Don't fail the deployment - just warn the user
                alert(`⚠️ Mint transaction is taking longer than expected.\n\nTransaction: ${mintHash}\n\nPlease check BaseScan to verify if it completed. If it succeeded, you can continue. If it failed, you may need to manually mint SC tokens to your address.`);
                
                // Mark as completed anyway so deployment can continue
                console.log("⚠️  Continuing deployment despite timeout - verify transaction manually");
              } else {
                throw receiptError;
              }
            }
          } catch (mintError: any) {
            console.error("❌ Mint transaction error:", mintError);
            console.error("   Error message:", mintError.message);
            console.error("   Error code:", mintError.code);
            console.error("   Error details:", mintError);
            throw new Error(`Failed to mint initial SC: ${mintError.message || mintError.toString()}`);
          }
        } else {
          console.log(`✅ Deployer already has ${Number(deployerBalance) / 10 ** 18} SC`);
        }
        
        updateStepStatus("init-member", "completed");
      } catch (memberError: any) {
        console.error("❌ Member initialization failed:", memberError);
        updateStepStatus("init-member", "failed", { error: memberError.message || "Member initialization failed" });
        throw new Error(`Member initialization failed: ${memberError.message || memberError.toString()}`);
      }

      // Save co-op configuration to database
      updateStepStatus("save-db", "deploying");
      try {
        console.log("Saving co-op configuration to database...");
        
        // Ensure required fields have values
        const coopName = coopConfig.name.trim() || "New Co-op";
        const coopShortName = coopConfig.shortName.trim() || coopName.substring(0, 20);
        const coopId = coopShortName.toLowerCase().replace(/\s+/g, "-");
        const coopTagline = coopConfig.tagline.trim() || "Building economic empowerment together";
        const coopDescription = coopConfig.description.trim() || `${coopName} - A cooperative for economic empowerment.`;
        
        // Convert hex colors to Tailwind classes for consistency, or keep hex for custom colors
        const bgColor = coopConfig.primaryColor || "#2563eb";
        const accentColor = coopConfig.accentColor || "#16a34a";

        await createCoopConfig.mutateAsync({
          coopId,
          walletAddress: address,
          reason: "Initial deployment via web UI",
          name: coopName,
          slug: coopId,
          tagline: coopTagline,
          description: coopDescription,
          displayMission: coopDescription,
          displayFeatures: [
            { title: "Shared Wealth Fund", description: "Community fund for collective investment and support." },
            { title: "Democratic Governance", description: "Members vote on proposals and shape priorities." },
            { title: "Local Economy", description: "Support local businesses and keep wealth in the community." },
          ],
          eligibility: "Open to all community members",
          bgColor: bgColor,
          accentColor: accentColor,
          displayOrder: 999,
          applicationQuestions: [
            {
              id: "fullName",
              type: "text",
              label: "Full Name",
              placeholder: "Enter your full name",
              required: true,
            },
            {
              id: "email",
              type: "email",
              label: "Email Address",
              placeholder: "your.email@example.com",
              required: true,
            },
            {
              id: "phone",
              type: "phone",
              label: "Phone Number",
              placeholder: "(555) 123-4567",
              required: true,
            },
            {
              id: "occupation",
              type: "text",
              label: "Current Occupation",
              placeholder: "e.g., Teacher, Entrepreneur, Student",
              required: false,
            },
            {
              id: "whyJoin",
              type: "textarea",
              label: "Why do you want to join?",
              description: "Tell us about your interest in the cooperative",
              placeholder: "Share your motivation...",
              required: true,
            },
          ],
          charterText: `${coopName} Charter - Building economic empowerment through cooperative ownership.`,
          quorumPercent: coopConfig.quorumPercent,
          approvalThresholdPercent: coopConfig.approvalThresholdPercent,
          votingWindowDays: coopConfig.votingWindowDays,
          // Chain configuration fields (merged into CoopConfig)
          chainId: selectedChain.id,
          chainName: network === "baseSepolia" ? "base-sepolia" : "base-mainnet",
          rpcUrl: customRpcUrl || selectedChain.rpcUrls.default.http[0],
          scTokenAddress: soulaaniCoinAddress,
          allyTokenAddress: allyCoinAddress,
          ucTokenAddress: unityCoinAddress,
          redemptionVaultAddress: redemptionVaultAddress || soulaaniCoinAddress,
          treasurySafeAddress: treasuryAddress,
          verifiedStoreRegistryAddress: verifiedStoreRegistryAddress || soulaaniCoinAddress,
          rewardEngineAddress: scRewardEngineAddress || soulaaniCoinAddress,
          storePaymentRouterAddress: storePaymentRouterAddress || soulaaniCoinAddress,
          backendWalletAddress: address,
          scTokenSymbol: coopConfig.scTokenSymbol.trim(),
          scTokenName: coopConfig.scTokenName.trim(),
        });
        console.log("✅ Co-op configuration (including chain config) saved to database");
        
        updateStepStatus("save-db", "completed");
      } catch (dbError: any) {
        console.error("Failed to save to database:", dbError);
        updateStepStatus("save-db", "failed", { error: dbError.message || "Database save failed" });
      }

      setCurrentPhase("complete");
    } catch (error: any) {
      console.error("💥 Deployment failed:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      alert(`Deployment failed: ${error.message || "Unknown error"}`);
      const failedStep = deploymentSteps.find((s) => s.status === "deploying");
      if (failedStep) {
        updateStepStatus(failedStep.id, "failed", { error: error.message });
      }
    }
  };

  const downloadConfig = () => {
    const config = {
      coopConfig: {
        ...coopConfig,
        network,
      },
      contracts: deployedContracts,
      deployedAt: new Date().toISOString(),
      deployer: address,
      chainId: network === "baseSepolia" ? 84532 : 8453,
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${coopConfig.shortName || "coop"}-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEnvFile = () => {
    const envContent = `# Co-op Configuration
COOP_NAME="${coopConfig.name}"
COOP_SHORT_NAME="${coopConfig.shortName}"
COOP_TAGLINE="${coopConfig.tagline}"
COOP_PRIMARY_COLOR="${coopConfig.primaryColor}"
COOP_ACCENT_COLOR="${coopConfig.accentColor}"

# Chain contract addresses and the initializer wallet address are stored in CoopConfig.
# Do not add per-coop contract addresses or backend wallet private keys to env files.
#
# Governance
TREASURY_SAFE_ADDRESS="${coopConfig.treasuryAddress || address || ""}"
GOVERNANCE_BOT_ADDRESS="${coopConfig.governanceBotAddress || address || ""}"

# Network
CHAIN_ID="${network === "baseSepolia" ? "84532" : "8453"}"
RPC_URL="${network === "baseSepolia" ? "https://sepolia.base.org" : (customRpcUrl || "https://base.llamarpc.com")}"

# Payment Settings
MIN_PAYMENT_AMOUNT="${coopConfig.minPaymentAmount}"
MAX_PAYMENT_AMOUNT="${coopConfig.maxPaymentAmount}"
CLAIM_EXPIRATION_DAYS="${coopConfig.claimExpirationDays}"
WITHDRAWAL_MIN_AMOUNT="${coopConfig.withdrawalMinAmount}"

# Fees
P2P_FEE_PERCENT="${coopConfig.p2pFeePercent}"
WITHDRAWAL_FEE_PERCENT="${coopConfig.withdrawalFeePercent}"
WITHDRAWAL_FEE_FLAT="${coopConfig.withdrawalFeeFlat}"

# Governance Parameters
QUORUM_PERCENT="${coopConfig.quorumPercent}"
APPROVAL_THRESHOLD_PERCENT="${coopConfig.approvalThresholdPercent}"
VOTING_WINDOW_DAYS="${coopConfig.votingWindowDays}"
SCREENING_PASS_THRESHOLD="${coopConfig.screeningPassThreshold}"
`;

    const blob = new Blob([envContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `.env.${coopConfig.shortName || "coop"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const explorerUrl = network === "baseSepolia" 
    ? "https://sepolia.basescan.org" 
    : "https://basescan.org";

  const completedSteps = deploymentSteps.filter((s) => s.status === "completed").length;
  const progress = (completedSteps / deploymentSteps.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        {/* API Connection Status */}
        {apiConnected === false && (
          <Alert className="mb-6 border-red-500 bg-red-50 dark:bg-red-950">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-900 dark:text-red-100">API Connection Failed</AlertTitle>
            <AlertDescription className="text-red-800 dark:text-red-200">
              Cannot connect to the backend API. Please ensure the API server is running.
              {apiError && <div className="mt-1 text-xs font-mono">{apiError}</div>}
            </AlertDescription>
          </Alert>
        )}
        
        {apiConnected === true && (
          <Alert className="mb-6 border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-900 dark:text-green-100">API Connected</AlertTitle>
            <AlertDescription className="text-green-800 dark:text-green-200">
              Successfully connected to backend services.
            </AlertDescription>
          </Alert>
        )}

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Initialize Your Co-op
          </h1>
          <p className="text-lg text-muted-foreground">
            Deploy smart contracts and configure your cooperative in one seamless flow
          </p>
        </div>

        {/* Phase Indicator */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 ${currentPhase === "config" ? "text-blue-600 font-semibold" : currentPhase === "deploy" || currentPhase === "complete" ? "text-green-600" : "text-muted-foreground"}`}>
              {currentPhase === "deploy" || currentPhase === "complete" ? <CheckCircle2 className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-current" />}
              <span>1. Configure</span>
            </div>
            <div className="w-12 h-0.5 bg-border" />
            <div className={`flex items-center gap-2 ${currentPhase === "deploy" ? "text-blue-600 font-semibold" : currentPhase === "complete" ? "text-green-600" : "text-muted-foreground"}`}>
              {currentPhase === "complete" ? <CheckCircle2 className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-current" />}
              <span>2. Deploy</span>
            </div>
            <div className="w-12 h-0.5 bg-border" />
            <div className={`flex items-center gap-2 ${currentPhase === "complete" ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>
              {currentPhase === "complete" ? <CheckCircle2 className="w-5 h-5" /> : <div className="w-5 h-5 rounded-full border-2 border-current" />}
              <span>3. Complete</span>
            </div>
          </div>
        </div>

        {/* Configuration Phase */}
        {currentPhase === "config" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Wallet Connection</CardTitle>
                <CardDescription>Connect your wallet to deploy contracts</CardDescription>
              </CardHeader>
              <CardContent>
                {!isConnected ? (
                  <div className="text-center py-8">
                    <p className="mb-4 text-muted-foreground">Connect your wallet to get started</p>
                    <Button onClick={() => open()} size="lg">
                      Connect Wallet
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                      <div>
                        <p className="font-medium text-green-900 dark:text-green-100">Wallet Connected</p>
                        <p className="text-sm text-green-700 dark:text-green-300 font-mono">{address}</p>
                        {connectedChain && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            Connected to: {connectedChain.name} (Chain ID: {connectedChain.id})
                          </p>
                        )}
                      </div>
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    </div>
                    
                    <div>
                      <Label>Target Network for Deployment</Label>
                      <Select value={network} onValueChange={(v) => setNetwork(v as any)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="baseSepolia">Base Sepolia (Testnet)</SelectItem>
                          <SelectItem value="base">Base (Mainnet)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Choose which network to deploy your contracts to
                      </p>
                    </div>

                    {network === "base" && (
                      <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                        <Info className="h-4 w-4 text-blue-600" />
                        <AlertTitle className="text-blue-900 dark:text-blue-100">RPC Configuration for Base Mainnet</AlertTitle>
                        <AlertDescription className="text-blue-800 dark:text-blue-200">
                          <div className="space-y-3 mt-2">
                            <div>
                              <Label htmlFor="customRpcUrl" className="text-blue-900 dark:text-blue-100">Custom RPC URL (Recommended for Production)</Label>
                              <Input
                                id="customRpcUrl"
                                placeholder="https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
                                value={customRpcUrl}
                                onChange={(e) => setCustomRpcUrl(e.target.value)}
                                className="mt-1 bg-white dark:bg-slate-900"
                              />
                            </div>
                            <div className="text-xs space-y-1">
                              <p><strong>Leave empty</strong> to use free public RPC (may be rate-limited)</p>
                              <p><strong>Recommended providers:</strong></p>
                              <ul className="list-disc list-inside ml-2 space-y-0.5">
                                <li><strong>Alchemy:</strong> https://base-mainnet.g.alchemy.com/v2/YOUR_KEY</li>
                                <li><strong>QuickNode:</strong> Your custom endpoint URL</li>
                                <li><strong>Infura:</strong> https://base-mainnet.infura.io/v3/YOUR_KEY</li>
                              </ul>
                              <p className="mt-2 text-blue-700 dark:text-blue-300">
                                Get free API keys at <a href="https://www.alchemy.com" target="_blank" rel="noopener noreferrer" className="underline">alchemy.com</a> or <a href="https://www.quicknode.com" target="_blank" rel="noopener noreferrer" className="underline">quicknode.com</a>
                              </p>
                            </div>
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {isConnected && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Co-op Identity</CardTitle>
                    <CardDescription>Basic information about your cooperative</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">Full Name *</Label>
                        <Input
                          id="name"
                          placeholder="Cahootz Co-operative"
                          value={coopConfig.name}
                          onChange={(e) => setCoopConfig({ ...coopConfig, name: e.target.value })}
                          className={!coopConfig.name.trim() ? "border-red-500" : ""}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Required - will appear in mobile app
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="shortName">Short Name *</Label>
                        <Input
                          id="shortName"
                          placeholder="Soulaan"
                          value={coopConfig.shortName}
                          onChange={(e) => setCoopConfig({ ...coopConfig, shortName: e.target.value })}
                          className={!coopConfig.shortName.trim() ? "border-red-500" : ""}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Required - used for URLs and IDs
                        </p>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="tagline">Tagline *</Label>
                      <Input
                        id="tagline"
                        placeholder="Building Generational Wealth Together"
                        value={coopConfig.tagline}
                        onChange={(e) => setCoopConfig({ ...coopConfig, tagline: e.target.value })}
                        className={!coopConfig.tagline.trim() ? "border-red-500" : ""}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Required - appears in mobile app co-op list
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        placeholder="A brief description of your co-op's mission and purpose..."
                        rows={4}
                        value={coopConfig.description}
                        onChange={(e) => setCoopConfig({ ...coopConfig, description: e.target.value })}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="scTokenName">Governance Token Name *</Label>
                        <Input
                          id="scTokenName"
                          placeholder="SoulaaniCoin"
                          value={coopConfig.scTokenName}
                          onChange={(e) => setCoopConfig({ ...coopConfig, scTokenName: e.target.value })}
                          className={!coopConfig.scTokenName.trim() ? "border-red-500" : ""}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Full name for your governance token
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="scTokenSymbol">Token Symbol *</Label>
                        <Input
                          id="scTokenSymbol"
                          placeholder="SC"
                          value={coopConfig.scTokenSymbol}
                          onChange={(e) => setCoopConfig({ ...coopConfig, scTokenSymbol: e.target.value.toUpperCase() })}
                          className={!coopConfig.scTokenSymbol.trim() ? "border-red-500" : ""}
                          maxLength={6}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          2-6 characters (e.g., SC, SFNC)
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="primaryColor">Primary Color</Label>
                        <div className="flex gap-2">
                          <Input
                            id="primaryColor"
                            type="color"
                            value={coopConfig.primaryColor}
                            onChange={(e) => setCoopConfig({ ...coopConfig, primaryColor: e.target.value })}
                            className="w-20 h-10"
                          />
                          <Input
                            value={coopConfig.primaryColor}
                            onChange={(e) => setCoopConfig({ ...coopConfig, primaryColor: e.target.value })}
                            placeholder="#2563eb"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="accentColor">Accent Color</Label>
                        <div className="flex gap-2">
                          <Input
                            id="accentColor"
                            type="color"
                            value={coopConfig.accentColor}
                            onChange={(e) => setCoopConfig({ ...coopConfig, accentColor: e.target.value })}
                            className="w-20 h-10"
                          />
                          <Input
                            value={coopConfig.accentColor}
                            onChange={(e) => setCoopConfig({ ...coopConfig, accentColor: e.target.value })}
                            placeholder="#16a34a"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Contract Selection</CardTitle>
                    <CardDescription>Choose which contracts to deploy</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertTitle>Cost Optimization</AlertTitle>
                      <AlertDescription>
                        <strong>UnityCoin</strong> and <strong>SoulaaniCoin</strong> are required (always deployed).
                        The other contracts are optional and can be deployed later if needed.
                        <div className="mt-2 text-sm">
                          <strong>Minimal setup:</strong> ~$50-75 (just UC + SC)<br />
                          <strong>Full setup:</strong> ~$150-300 (all 6 contracts)
                        </div>
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <Checkbox
                          id="redemptionVault"
                          checked={optionalContracts.redemptionVault}
                          onCheckedChange={(checked) =>
                            setOptionalContracts({ ...optionalContracts, redemptionVault: checked as boolean })
                          }
                        />
                        <div className="flex-1">
                          <Label htmlFor="redemptionVault" className="font-medium cursor-pointer">
                            RedemptionVault
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Allows members to convert UC back to USD. Skip if handling redemptions manually via backend.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <Checkbox
                          id="verifiedStoreRegistry"
                          checked={optionalContracts.verifiedStoreRegistry}
                          onCheckedChange={(checked) =>
                            setOptionalContracts({ ...optionalContracts, verifiedStoreRegistry: checked as boolean })
                          }
                        />
                        <div className="flex-1">
                          <Label htmlFor="verifiedStoreRegistry" className="font-medium cursor-pointer">
                            VerifiedStoreRegistry
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            On-chain store verification system. Skip if managing stores in your database.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <Checkbox
                          id="scRewardEngine"
                          checked={optionalContracts.scRewardEngine}
                          onCheckedChange={(checked) =>
                            setOptionalContracts({ ...optionalContracts, scRewardEngine: checked as boolean })
                          }
                          disabled={!optionalContracts.verifiedStoreRegistry}
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor="scRewardEngine"
                            className={`font-medium ${!optionalContracts.verifiedStoreRegistry ? "opacity-50" : "cursor-pointer"}`}
                          >
                            SCRewardEngine {!optionalContracts.verifiedStoreRegistry && "(requires registry)"}
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Automatic on-chain SC reward calculation. Skip if awarding SC from your backend.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <Checkbox
                          id="storePaymentRouter"
                          checked={optionalContracts.storePaymentRouter}
                          onCheckedChange={(checked) =>
                            setOptionalContracts({ ...optionalContracts, storePaymentRouter: checked as boolean })
                          }
                          disabled={!optionalContracts.verifiedStoreRegistry || !optionalContracts.scRewardEngine}
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor="storePaymentRouter"
                            className={`font-medium ${(!optionalContracts.verifiedStoreRegistry || !optionalContracts.scRewardEngine) ? "opacity-50" : "cursor-pointer"}`}
                          >
                            StorePaymentRouter {(!optionalContracts.verifiedStoreRegistry || !optionalContracts.scRewardEngine) && "(requires registry + engine)"}
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Canonical payment routing system. Skip if routing payments in your backend.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Governance Settings</CardTitle>
                    <CardDescription>Configure voting and decision-making parameters</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="treasuryAddress">Treasury Safe Address</Label>
                        <Input
                          id="treasuryAddress"
                          placeholder={address || "0x..."}
                          value={coopConfig.treasuryAddress}
                          onChange={(e) => setCoopConfig({ ...coopConfig, treasuryAddress: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Leave empty to use your wallet address
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="governanceBotAddress">Governance Bot Address</Label>
                        <Input
                          id="governanceBotAddress"
                          placeholder={address || "0x..."}
                          value={coopConfig.governanceBotAddress}
                          onChange={(e) => setCoopConfig({ ...coopConfig, governanceBotAddress: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Leave empty to use your wallet address
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="quorumPercent">Quorum Percentage</Label>
                        <Input
                          id="quorumPercent"
                          type="number"
                          min="1"
                          max="100"
                          value={coopConfig.quorumPercent}
                          onChange={(e) => setCoopConfig({ ...coopConfig, quorumPercent: parseFloat(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          % of members needed to vote
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="approvalThreshold">Approval Threshold</Label>
                        <Input
                          id="approvalThreshold"
                          type="number"
                          min="1"
                          max="100"
                          value={coopConfig.approvalThresholdPercent}
                          onChange={(e) => setCoopConfig({ ...coopConfig, approvalThresholdPercent: parseFloat(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          % of votes needed to pass
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="votingWindowDays">Voting Window (Days)</Label>
                        <Input
                          id="votingWindowDays"
                          type="number"
                          min="1"
                          max="30"
                          value={coopConfig.votingWindowDays}
                          onChange={(e) => setCoopConfig({ ...coopConfig, votingWindowDays: parseInt(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="screeningThreshold">AI Screening Threshold</Label>
                        <Input
                          id="screeningThreshold"
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          value={coopConfig.screeningPassThreshold}
                          onChange={(e) => setCoopConfig({ ...coopConfig, screeningPassThreshold: parseFloat(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Minimum score to pass (0-1)
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Payment & Fee Settings</CardTitle>
                    <CardDescription>Configure transaction limits and fees</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="minPayment">Min Payment Amount</Label>
                        <Input
                          id="minPayment"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coopConfig.minPaymentAmount}
                          onChange={(e) => setCoopConfig({ ...coopConfig, minPaymentAmount: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="maxPayment">Max Payment Amount</Label>
                        <Input
                          id="maxPayment"
                          type="number"
                          min="0"
                          value={coopConfig.maxPaymentAmount}
                          onChange={(e) => setCoopConfig({ ...coopConfig, maxPaymentAmount: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="p2pFee">P2P Fee (%)</Label>
                        <Input
                          id="p2pFee"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={coopConfig.p2pFeePercent}
                          onChange={(e) => setCoopConfig({ ...coopConfig, p2pFeePercent: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="withdrawalFeePercent">Withdrawal Fee (%)</Label>
                        <Input
                          id="withdrawalFeePercent"
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={coopConfig.withdrawalFeePercent}
                          onChange={(e) => setCoopConfig({ ...coopConfig, withdrawalFeePercent: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="withdrawalFeeFlat">Withdrawal Fee (Flat)</Label>
                        <Input
                          id="withdrawalFeeFlat"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coopConfig.withdrawalFeeFlat}
                          onChange={(e) => setCoopConfig({ ...coopConfig, withdrawalFeeFlat: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="claimExpiration">Claim Expiration (Days)</Label>
                        <Input
                          id="claimExpiration"
                          type="number"
                          min="1"
                          value={coopConfig.claimExpirationDays}
                          onChange={(e) => setCoopConfig({ ...coopConfig, claimExpirationDays: parseInt(e.target.value) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="withdrawalMin">Min Withdrawal Amount</Label>
                        <Input
                          id="withdrawalMin"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coopConfig.withdrawalMinAmount}
                          onChange={(e) => setCoopConfig({ ...coopConfig, withdrawalMinAmount: parseFloat(e.target.value) })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <CoopConfigPreview config={coopConfig} />

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Ready to Deploy?</AlertTitle>
                  <AlertDescription>
                    {network === "base" && (
                      <div className="mb-2">
                        <strong>Estimated cost:</strong>{" "}
                        {!optionalContracts.redemptionVault && 
                         !optionalContracts.verifiedStoreRegistry && 
                         !optionalContracts.scRewardEngine && 
                         !optionalContracts.storePaymentRouter
                          ? "~$60-90 (minimal: SC + ALLY + UC)"
                          : optionalContracts.redemptionVault && 
                            !optionalContracts.verifiedStoreRegistry
                          ? "~$110-160 (with redemption vault)"
                          : "~$160-320 (full setup)"}
                      </div>
                    )}
                    Make sure you have enough ETH in your wallet for gas fees. Deployment will take 1-5 minutes.
                    {network === "baseSepolia" && (
                      <a
                        href="https://www.coinbase.com/faucets/base-ethereum-goerli-faucet"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mt-2 text-blue-600 hover:underline"
                      >
                        Get test ETH from faucet →
                      </a>
                    )}
                  </AlertDescription>
                </Alert>

                {isWrongNetwork && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Wrong Network</AlertTitle>
                    <AlertDescription>
                      Your wallet is connected to <strong>{connectedChain?.name || 'Unknown Network'}</strong> (Chain ID: {connectedChain?.id}), 
                      but you selected <strong>{network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"}</strong> (Chain ID: {network === "baseSepolia" ? "84532" : "8453"}).
                      <div className="mt-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={handleSwitchNetwork}
                          disabled={isSwitchingNetwork}
                          className="bg-white/10 hover:bg-white/20"
                        >
                          {isSwitchingNetwork ? "Switching..." : `Switch to ${network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"}`}
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {(!coopConfig.name.trim() || !coopConfig.shortName.trim() || !coopConfig.tagline.trim() || !coopConfig.scTokenName.trim() || !coopConfig.scTokenSymbol.trim()) && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Required Fields Missing</AlertTitle>
                    <AlertDescription>
                      Please fill in the <strong>Co-op Name</strong>, <strong>Short Name</strong>, <strong>Tagline</strong>, <strong>Token Name</strong>, and <strong>Token Symbol</strong> fields above. 
                      These are required for your co-op to appear in the mobile app.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex justify-end">
                  <Button
                    size="lg"
                    onClick={deployContracts}
                    disabled={
                      !coopConfig.name.trim() || 
                      !coopConfig.shortName.trim() || 
                      !coopConfig.tagline.trim() || 
                      !coopConfig.scTokenName.trim() || 
                      !coopConfig.scTokenSymbol.trim() ||
                      isWrongNetwork
                    }
                  >
                    Start Deployment
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Deployment Phase */}
        {currentPhase === "deploy" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Deploying Contracts</CardTitle>
                <CardDescription>
                  Please wait while we deploy your contracts to {network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Progress</span>
                    <span className="text-sm text-muted-foreground">
                      {completedSteps} / {deploymentSteps.length} steps
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                <div className="space-y-3">
                  {deploymentSteps.map((step) => (
                    <DeploymentStep
                      key={step.id}
                      stepId={step.id}
                      name={step.name}
                      description={step.description}
                      status={step.status}
                      txHash={step.txHash}
                      contractAddress={step.contractAddress}
                      error={step.error}
                      explorerUrl={explorerUrl}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Completion Phase */}
        {currentPhase === "complete" && (
          <div className="space-y-6">
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="bg-green-50 dark:bg-green-950">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                  <div>
                    <CardTitle className="text-green-900 dark:text-green-100">Deployment Successful!</CardTitle>
                    <CardDescription className="text-green-700 dark:text-green-300">
                      Your co-op contracts are now live on {network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">Deployed Contracts</h3>
                  <div className="space-y-3">
                    {[
                      { name: "SoulaaniCoin (SC)", address: deployedContracts.soulaaniCoin, description: "Governance token", required: true },
                      { name: "AllyCoin (ALLY)", address: deployedContracts.allyCoin, description: "Cross-coop membership", required: true },
                      { name: "UnityCoin (UC)", address: deployedContracts.unityCoin, description: "Main payment currency", required: true },
                      { name: "RedemptionVault", address: deployedContracts.redemptionVault, description: "Handles redemptions", required: false },
                      { name: "VerifiedStoreRegistry", address: deployedContracts.verifiedStoreRegistry, description: "Store verification", required: false },
                      { name: "SCRewardEngine", address: deployedContracts.scRewardEngine, description: "Reward calculation", required: false },
                      { name: "StorePaymentRouter", address: deployedContracts.storePaymentRouter, description: "Payment routing", required: false },
                    ]
                      .filter((contract) => contract.address)
                      .map((contract) => (
                        <ContractCard
                          key={contract.name}
                          name={contract.name}
                          address={contract.address!}
                          description={contract.description}
                          explorerUrl={explorerUrl}
                        />
                      ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-3">Co-op Configuration</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 bg-muted/50 rounded">
                      <p className="text-muted-foreground">Name</p>
                      <p className="font-medium">{coopConfig.name}</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded">
                      <p className="text-muted-foreground">Short Name</p>
                      <p className="font-medium">{coopConfig.shortName}</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded">
                      <p className="text-muted-foreground">Quorum</p>
                      <p className="font-medium">{coopConfig.quorumPercent}%</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded">
                      <p className="text-muted-foreground">Approval Threshold</p>
                      <p className="font-medium">{coopConfig.approvalThresholdPercent}%</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded">
                      <p className="text-muted-foreground">Voting Window</p>
                      <p className="font-medium">{coopConfig.votingWindowDays} days</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded">
                      <p className="text-muted-foreground">Network</p>
                      <p className="font-medium">{network === "baseSepolia" ? "Base Sepolia" : "Base Mainnet"}</p>
                    </div>
                  </div>
                </div>

                {deploymentSteps.find(s => s.id === "save-db")?.status === "completed" && (
                  <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertTitle className="text-green-900 dark:text-green-100">Co-op Registered!</AlertTitle>
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      Your co-op <strong>{coopConfig.name}</strong> is now visible in the mobile app. 
                      New members can discover and join your co-op through the onboarding flow.
                    </AlertDescription>
                  </Alert>
                )}

                {deploymentSteps.find(s => s.id === "save-db")?.status === "failed" && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Database Save Failed</AlertTitle>
                    <AlertDescription>
                      Your contracts deployed successfully, but we couldn't save your co-op to the database. 
                      Your co-op won't appear in the mobile app until this is resolved. 
                      Contact support with your deployment details.
                    </AlertDescription>
                  </Alert>
                )}

                <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <Info className="h-4 w-4 text-blue-600" />
                  <AlertTitle className="text-blue-900 dark:text-blue-100">Access Your Portal</AlertTitle>
                  <AlertDescription className="text-blue-800 dark:text-blue-200">
                    <p className="mb-3">Your co-op portal is now ready! Log in to manage members, proposals, and treasury.</p>
                    <Button 
                      onClick={() => window.location.href = `/login?coopId=${coopConfig.shortName.toLowerCase()}`}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Go to Portal Login
                    </Button>
                  </AlertDescription>
                </Alert>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Next Steps</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Download your configuration files below</li>
                      <li>Add the .env file to your backend server</li>
                      <li>Verify contracts on BaseScan (optional but recommended)</li>
                      <li>Set up event indexing for your backend</li>
                      <li>Configure reward policies via the admin panel</li>
                    </ol>
                  </AlertDescription>
                </Alert>

                <div className="flex gap-3">
                  <Button onClick={downloadConfig} variant="outline" className="flex-1">
                    Download JSON Config
                  </Button>
                  <Button onClick={downloadEnvFile} className="flex-1">
                    Download .env File
                  </Button>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-semibold mb-2">Verification Commands (Optional)</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Run these commands to verify your contracts on BaseScan
                  </p>
                  <div className="space-y-2">
                    {deployedContracts.soulaaniCoin && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.soulaaniCoin} {coopConfig.governanceBotAddress || address}
                      </div>
                    )}
                    {deployedContracts.allyCoin && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.allyCoin} {coopConfig.governanceBotAddress || address} {deployedContracts.soulaaniCoin}
                      </div>
                    )}
                    {deployedContracts.unityCoin && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.unityCoin} {coopConfig.treasuryAddress || address} {deployedContracts.soulaaniCoin} {address}
                      </div>
                    )}
                    {deployedContracts.redemptionVault && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.redemptionVault} {deployedContracts.unityCoin} [USDC_ADDRESS] {coopConfig.treasuryAddress || address}
                      </div>
                    )}
                    {deployedContracts.verifiedStoreRegistry && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.verifiedStoreRegistry} {coopConfig.governanceBotAddress || address}
                      </div>
                    )}
                    {deployedContracts.scRewardEngine && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.scRewardEngine} {coopConfig.governanceBotAddress || address} {deployedContracts.soulaaniCoin} {deployedContracts.verifiedStoreRegistry}
                      </div>
                    )}
                    {deployedContracts.storePaymentRouter && (
                      <div className="p-3 bg-muted/50 rounded font-mono text-xs overflow-x-auto">
                        npx hardhat verify --network {network} {deployedContracts.storePaymentRouter} {coopConfig.governanceBotAddress || address} {deployedContracts.unityCoin} {deployedContracts.verifiedStoreRegistry} {deployedContracts.scRewardEngine}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
