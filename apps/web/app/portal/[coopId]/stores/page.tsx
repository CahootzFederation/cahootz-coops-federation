"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useCoin } from "@/hooks/use-platform-config";
import { useCoopContext } from "@/lib/coop-context";
import { env } from "~/env";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Store,
  Globe,
  ExternalLink,
  ShieldCheck,
  Star,
  StarOff,
  Package,
  Search,
  Eye,
  DollarSign,
  Coins,
  AlertTriangle,
  RefreshCw,
  Link2,
  Link2Off,
  Ban,
  Trash2,
} from "lucide-react";
import { CreateStoreDialog } from "@/components/portal/create-store-dialog";
import { CreateProductDialog } from "@/components/portal/create-product-dialog";
import { BulkProductImportDialog } from "@/components/portal/bulk-product-import-dialog";
import { EditStoreDialog } from "@/components/portal/edit-store-dialog";
import { EditProductDialog } from "@/components/portal/edit-product-dialog";

type MainTab = "applications" | "stores" | "orders" | "featured";
type ApplicationStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type StoreStatus = "PENDING" | "APPROVED" | "SUSPENDED" | "REJECTED";
type OrderSource = "ALL" | "STORE_ORDER" | "COMMERCE_TRANSACTION";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatOrderDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function shortOrderId(id: string) {
  return id.length > 12 ? id.slice(-12) : id;
}

function orderStatusClass(status: string | null) {
  if (status === "COMPLETED" || status === "DELIVERED") return "bg-green-600";
  if (status === "FAILED" || status === "CANCELLED" || status === "REFUNDED") return "bg-red-600";
  if (status === "PROCESSING" || status === "SHIPPED") return "bg-blue-600";
  return "bg-yellow-600";
}

export default function StoreManagementPage() {
  const { coopId } = useCoopContext();
  const [mainTab, setMainTab] = useState<MainTab>("stores");

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Store Management</h1>
          <p className="text-gray-400 mt-1">Manage stores, applications, and featured products</p>
        </div>
        <CreateStoreDialog coopId={coopId} onSuccess={() => window.location.reload()} />
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 bg-slate-900 rounded-lg p-2">
        <Button
          onClick={() => setMainTab("stores")}
          variant={mainTab === "stores" ? "default" : "ghost"}
          className={mainTab === "stores" ? "bg-amber-600 hover:bg-amber-700" : ""}
        >
          <Store className="h-4 w-4 mr-2" />
          All Stores
        </Button>
        <Button
          onClick={() => setMainTab("orders")}
          variant={mainTab === "orders" ? "default" : "ghost"}
          className={mainTab === "orders" ? "bg-amber-600 hover:bg-amber-700" : ""}
        >
          <DollarSign className="h-4 w-4 mr-2" />
          Orders
        </Button>
        <Button
          onClick={() => setMainTab("applications")}
          variant={mainTab === "applications" ? "default" : "ghost"}
          className={mainTab === "applications" ? "bg-amber-600 hover:bg-amber-700" : ""}
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Applications
        </Button>
        <Button
          onClick={() => setMainTab("featured")}
          variant={mainTab === "featured" ? "default" : "ghost"}
          className={mainTab === "featured" ? "bg-amber-600 hover:bg-amber-700" : ""}
        >
          <Star className="h-4 w-4 mr-2" />
          Featured Products
        </Button>
      </div>

      {/* Tab Content */}
      {mainTab === "stores" && <AllStoresTab />}
      {mainTab === "orders" && <AllOrdersTab />}
      {mainTab === "applications" && <ApplicationsTab />}
      {mainTab === "featured" && <FeaturedProductsTab />}
    </div>
  );
}

// ============================================
// ALL STORES TAB
// ============================================
function AllStoresTab() {
  const { coopId } = useCoopContext();
  const [statusFilter, setStatusFilter] = useState<StoreStatus | undefined>("APPROVED");
  const [search, setSearch] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { data, isLoading, refetch } = api.store.getAllStores.useQuery({
    status: statusFilter,
    search: search || undefined,
    includeDeleted,
  });

  const toggleFeatured = api.store.toggleFeatured.useMutation({
    onSuccess: () => refetch(),
  });

  const toggleScVerification = api.store.toggleScVerification.useMutation({
    onSuccess: (data) => {
      if (data.txHash) {
        setTxHash(data.txHash);
      }
      refetch();
    },
  });

  const setScVerifiedAdmin = api.store.setScVerifiedAdmin.useMutation({
    onSuccess: () => refetch(),
  });

  const batchVerify = api.store.batchVerifyStoresOnChain.useMutation({
    onSuccess: (data) => {
      if ("txHash" in data && data.txHash) {
        setTxHash(data.txHash);
      }
      refetch();
    },
  });

  const stores = data?.stores ?? [];

  const statusTabs: { label: string; value: StoreStatus | undefined }[] = [
    { label: "Approved", value: "APPROVED" },
    { label: "Pending", value: "PENDING" },
    { label: "Suspended", value: "SUSPENDED" },
    { label: "Rejected", value: "REJECTED" },
    { label: "All", value: undefined },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Transaction Status Banner */}
      {txHash && (
        <Card className="bg-green-900/20 border-green-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-sm font-medium text-green-400">Transaction Confirmed</p>
                  <p className="text-xs text-gray-400 mt-1">
                    View on BaseScan:{" "}
                    <a
                      href={`https://sepolia.basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      {txHash.slice(0, 10)}...{txHash.slice(-8)}
                    </a>
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTxHash(null)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex gap-2 bg-slate-800 rounded-lg p-1">
          {statusTabs.map((tab) => (
            <Button
              key={tab.label}
              onClick={() => setStatusFilter(tab.value)}
              variant={statusFilter === tab.value ? "default" : "ghost"}
              size="sm"
              className={statusFilter === tab.value ? "bg-slate-700" : ""}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search stores..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-slate-800 border-slate-700"
          />
        </div>
        <Button
          onClick={() => {
            setIncludeDeleted((value) => !value);
            if (!includeDeleted) setStatusFilter(undefined);
          }}
          variant="outline"
          className="border-slate-700"
        >
          {includeDeleted ? "Hide Deleted" : "Show Deleted"}
        </Button>
        <Button
          onClick={() => batchVerify.mutate({ limit: 50 })}
          disabled={batchVerify.isPending}
          variant="outline"
          className="border-amber-500/40 bg-transparent text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
        >
          {batchVerify.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Verifying On-Chain...
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 mr-2" />
              Batch Verify On-Chain
            </>
          )}
        </Button>
      </div>

      {/* Stores List */}
      {stores.length === 0 ? (
        <div className="text-center py-12">
          <Store className="h-12 w-12 mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400">No stores found</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {stores.map((store) => (
            <Card key={store.id} className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-lg text-white">{store.name}</h3>
                      {store.isScVerified && (
                        <Badge className="bg-amber-600 text-xs">
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          SC Verified
                        </Badge>
                      )}
                      {store.isFeatured && (
                        <Badge className="bg-purple-600 text-xs">
                          <Star className="h-3 w-3 mr-1" />
                          Featured
                        </Badge>
                      )}
                      {(store as any).deletedAt && (
                        <Badge className="bg-red-700 text-xs">
                          Deleted
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-400 mb-2">
                      {(store.category || "Uncategorized").replace(/_/g, " ")} • Owner: {store.owner.name || store.owner.email}
                    </p>
                    <div className="flex gap-4 text-sm text-gray-500">
                      <span><Package className="h-4 w-4 inline mr-1" />{store.productCount} products</span>
                      <span><DollarSign className="h-4 w-4 inline mr-1" />{store.orderCount} orders</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        store.status === "APPROVED"
                          ? "bg-green-600"
                          : store.status === "PENDING"
                          ? "bg-yellow-600"
                          : store.status === "SUSPENDED"
                          ? "bg-red-600"
                          : "bg-gray-600"
                      }
                    >
                      {store.status}
                    </Badge>
                    <EditStoreDialog 
                      coopId={coopId} 
                      store={{
                        id: store.id,
                        name: store.name,
                        description: store.description,
                        category: store.category,
                        imageUrl: (store as any).imageUrl,
                        bannerUrl: (store as any).bannerUrl,
                        ownerId: (store as any).ownerId,
                      }}
                      onSuccess={() => refetch()}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedStore(selectedStore === store.id ? null : store.id)}
                      className="hover:bg-slate-800"
                    >
                      <Eye className="h-4 w-4 text-gray-400 hover:text-white" />
                    </Button>
                  </div>
                </div>

                {/* Expanded View */}
                {selectedStore === store.id && (
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-4">
                    {/* Store Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-800 rounded-lg p-4">
                      <div>
                        <h4 className="text-sm font-medium text-gray-400 mb-2">Store Information</h4>
                        <div className="space-y-2 text-sm">
                          {store.description && (
                            <div>
                              <span className="text-gray-500">Description: </span>
                              <span className="text-white">{store.description}</span>
                            </div>
                          )}
                          {store.address && (
                            <div>
                              <span className="text-gray-500">Address: </span>
                              <span className="text-white">{store.address}</span>
                              {store.city && store.state && (
                                <span className="text-white">, {store.city}, {store.state}</span>
                              )}
                            </div>
                          )}
                          {store.phone && (
                            <div>
                              <span className="text-gray-500">Phone: </span>
                              <span className="text-white">{store.phone}</span>
                            </div>
                          )}
                          {store.email && (
                            <div>
                              <span className="text-gray-500">Email: </span>
                              <span className="text-white">{store.email}</span>
                            </div>
                          )}
                          {store.website && (
                            <div>
                              <span className="text-gray-500">Website: </span>
                              <a 
                                href={store.website} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-amber-400 hover:text-amber-300"
                              >
                                {store.website} <ExternalLink className="h-3 w-3 inline" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-400 mb-2">Settings & Stats</h4>
                        <div className="space-y-2 text-sm">
    
                          <div>
                            <span className="text-gray-500">Accepts UC: </span>
                            <span className="text-white">{store.acceptsUC ? 'Yes' : 'No'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Total Sales: </span>
                            <span className="text-white">${store.totalSales?.toFixed(2) || '0.00'}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Total Orders: </span>
                            <span className="text-white">{store.orderCount || 0}</span>
                          </div>
                          {store.rating && (
                            <div>
                              <span className="text-gray-500">Rating: </span>
                              <span className="text-white">{store.rating.toFixed(1)} ({store.reviewCount} reviews)</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleFeatured.mutate({ storeId: store.id, featured: !store.isFeatured })}
                        disabled={toggleFeatured.isPending}
                      >
                        {store.isFeatured ? (
                          <>
                            <StarOff className="h-4 w-4 mr-1" />
                            Remove Featured
                          </>
                        ) : (
                          <>
                            <Star className="h-4 w-4 mr-1" />
                            Make Featured
                          </>
                        )}
                      </Button>
                      {/* DB-only SC verification toggle (instant, no blockchain) */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setScVerifiedAdmin.mutate({ storeId: store.id, verified: !store.isScVerified })}
                        disabled={setScVerifiedAdmin.isPending}
                        className={store.isScVerified ? "border-red-600 text-red-400 hover:bg-red-600 hover:text-white" : "border-amber-600 text-amber-400 hover:bg-amber-600 hover:text-white"}
                      >
                        {setScVerifiedAdmin.isPending ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : store.isScVerified ? (
                          <XCircle className="h-4 w-4 mr-1" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 mr-1" />
                        )}
                        {store.isScVerified ? "Remove SC Verified" : "Mark SC Verified"}
                      </Button>
                      {/* On-chain verification (requires wallet + smart contract) */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleScVerification.mutate({ storeId: store.id, verified: !store.isScVerified })}
                        disabled={toggleScVerification.isPending}
                        className="border-slate-600 text-slate-400 hover:bg-slate-700 hover:text-white text-xs"
                        title="Sync SC verification to the blockchain (requires owner wallet)"
                      >
                        {toggleScVerification.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3 w-3 mr-1" />
                        )}
                        On-Chain
                      </Button>
                      <StoreStatusActions
                        storeId={store.id}
                        currentStatus={store.status}
                        isDeleted={!!(store as any).deletedAt}
                        onSuccess={() => refetch()}
                      />
                    </div>

                    {/* Stripe Connect Status */}
                    <StripeConnectStatusPanel store={store} />

                    {/* On-Chain Status Check - Disabled until VerifiedStoreRegistry is deployed */}
                    {/* <StoreOnChainStatusPanel
                      storeId={store.id}
                      onFixApplied={() => refetch()}
                    /> */}

                    {/* SC Rewards Section (only for SC-verified stores) */}
                    {store.isScVerified && (
                      <StoreSCRewardsPanel storeId={store.id} storeName={store.name} />
                    )}

                    <StoreOrdersPanel storeId={store.id} />

                    {/* Products Section */}
                    <StoreProductsPanel storeId={store.id} storeName={store.name} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// ALL ORDERS TAB
// ============================================
function AllOrdersTab() {
  const [sourceFilter, setSourceFilter] = useState<OrderSource>("ALL");
  const [search, setSearch] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const { data, isLoading, error, refetch } = api.store.getAllStoreOrdersAdmin.useQuery({
    source: sourceFilter,
    search: search || undefined,
    includeDeleted,
    limit: 75,
  });

  const updateOrderDeleted = api.store.updateOrderDeletedAdmin.useMutation({
    onSuccess: () => refetch(),
  });

  const orders = data?.orders ?? [];
  const sourceTabs: { label: string; value: OrderSource }[] = [
    { label: "All", value: "ALL" },
    { label: "Stripe Checkout", value: "COMMERCE_TRANSACTION" },
    { label: "Store Orders", value: "STORE_ORDER" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center">
        <div className="flex gap-2 bg-slate-800 rounded-lg p-1">
          {sourceTabs.map((tab) => (
            <Button
              key={tab.value}
              onClick={() => setSourceFilter(tab.value)}
              variant={sourceFilter === tab.value ? "default" : "ghost"}
              size="sm"
              className={sourceFilter === tab.value ? "bg-slate-700" : ""}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-10 bg-slate-800 border-slate-700"
          />
        </div>
        <Button variant="outline" onClick={() => refetch()} className="border-slate-700">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
        <Button
          variant="outline"
          onClick={() => setIncludeDeleted((value) => !value)}
          className="border-slate-700"
        >
          {includeDeleted ? "Hide Deleted" : "Show Deleted"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-[30vh]">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <Card className="bg-red-950/30 border-red-900">
          <CardContent className="p-4 text-red-300">{error.message}</CardContent>
        </Card>
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign className="h-12 w-12 mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400">No orders found</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          {orders.map((order) => (
            <OrderRow
              key={`${order.source}-${order.id}`}
              order={order}
              onToggleDeleted={(deleted) =>
                updateOrderDeleted.mutate({
                  orderId: order.id,
                  source: order.source,
                  deleted,
                })
              }
              isUpdating={updateOrderDeleted.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StoreOrdersPanel({ storeId }: { storeId: string }) {
  const { data, isLoading, error, refetch } = api.store.getAllStoreOrdersAdmin.useQuery({
    storeId,
    limit: 20,
  });

  const updateOrderDeleted = api.store.updateOrderDeletedAdmin.useMutation({
    onSuccess: () => refetch(),
  });

  const orders = data?.orders ?? [];

  return (
    <div>
      <h4 className="font-medium text-white mb-3">Orders ({orders.length})</h4>
      {isLoading ? (
        <div className="py-4 text-center text-gray-400">Loading orders...</div>
      ) : error ? (
        <div className="py-4 text-sm text-red-400">{error.message}</div>
      ) : orders.length === 0 ? (
        <div className="py-4 text-sm text-gray-400">No orders created for this store yet.</div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          {orders.map((order) => (
            <OrderRow
              key={`${order.source}-${order.id}`}
              order={order}
              compact
              onToggleDeleted={(deleted) =>
                updateOrderDeleted.mutate({
                  orderId: order.id,
                  source: order.source,
                  deleted,
                })
              }
              isUpdating={updateOrderDeleted.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderRow({
  order,
  compact = false,
  onToggleDeleted,
  isUpdating = false,
}: {
  order: any;
  compact?: boolean;
  onToggleDeleted?: (deleted: boolean) => void;
  isUpdating?: boolean;
}) {
  const sourceLabel = order.source === "COMMERCE_TRANSACTION" ? "Stripe" : "Store";
  const isDeleted = !!order.deletedAt;

  return (
    <div className={`bg-slate-900 border-b border-slate-800 last:border-b-0 p-4 ${isDeleted ? "opacity-70" : ""}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-semibold text-white">
              {compact ? shortOrderId(order.id) : `Order ${shortOrderId(order.id)}`}
            </h3>
            <Badge className="bg-slate-700">{sourceLabel}</Badge>
            <Badge className={orderStatusClass(order.paymentStatus)}>{order.paymentStatus}</Badge>
            {order.fulfillmentStatus && (
              <Badge className={orderStatusClass(order.fulfillmentStatus)}>{order.fulfillmentStatus}</Badge>
            )}
            {isDeleted && <Badge className="bg-red-700">Deleted</Badge>}
          </div>
          {!compact && (
            <p className="text-sm text-gray-400">
              {order.storeName} • {formatOrderDate(order.createdAt)}
            </p>
          )}
          <p className="text-sm text-gray-300 mt-2">
            {order.itemSummary || "Order total"}
            {order.itemCount > 1 ? ` (${order.itemCount} items)` : ""}
          </p>
          <div className="mt-2 grid gap-1 text-xs text-gray-500 md:grid-cols-2">
            <span>Customer: {order.customerName || order.customerEmail || "Unknown"}</span>
            <span>Email: {order.customerEmail || "None"}</span>
            {order.shippingAddress && <span className="md:col-span-2">Ship to: {order.shippingAddress}</span>}
            {order.transactionReference && (
              <span className="md:col-span-2">Reference: {shortOrderId(order.transactionReference)}</span>
            )}
          </div>
        </div>
        <div className="text-left md:text-right">
          <p className="text-lg font-bold text-white">{formatCurrency(order.totalUSD)}</p>
          <p className="text-xs text-gray-500">{order.paymentMethod}</p>
          {compact && <p className="text-xs text-gray-500 mt-1">{formatOrderDate(order.createdAt)}</p>}
          {onToggleDeleted && (
            <Button
              variant="outline"
              size="sm"
              disabled={isUpdating}
              onClick={() => onToggleDeleted(!isDeleted)}
              className={
                isDeleted
                  ? "mt-3 border-green-600 text-green-500 hover:bg-green-600 hover:text-white"
                  : "mt-3 border-red-600 text-red-500 hover:bg-red-600 hover:text-white"
              }
            >
              {isUpdating ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : isDeleted ? (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              ) : (
                <Trash2 className="h-3 w-3 mr-1" />
              )}
              {isDeleted ? "Restore" : "Soft Delete"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// STORE PRODUCTS PANEL
// ============================================
function StoreProductsPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const { data, isLoading, error, refetch } = api.store.getStoreProductsAdmin.useQuery({
    storeId,
    includeInactive: true,
  });

  const toggleProductFeatured = api.store.toggleProductFeatured.useMutation({
    onSuccess: () => refetch(),
  });

  const products = Array.isArray(data) ? data : [];

  if (isLoading) {
    return <div className="py-4 text-center text-gray-400">Loading products...</div>;
  }

  if (error) {
    return (
      <div className="py-4 text-center">
        <p className="text-red-400 mb-2">Error loading products</p>
        <p className="text-sm text-gray-500">{error.message}</p>
        <Button onClick={() => refetch()} size="sm" className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-gray-400 mb-2">No products yet</p>
        <div className="flex justify-center gap-2">
          <CreateProductDialog storeId={storeId} storeName={storeName} onSuccess={() => refetch()} />
          <BulkProductImportDialog storeId={storeId} storeName={storeName} onSuccess={() => refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-white">Products ({products.length})</h4>
        <div className="flex gap-2">
          <BulkProductImportDialog storeId={storeId} storeName={storeName} onSuccess={() => refetch()} />
          <CreateProductDialog storeId={storeId} storeName={storeName} onSuccess={() => refetch()} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {products.map((product) => (
          <div
            key={product.id}
            className={`bg-slate-800 rounded-lg p-3 border ${
              product.isFeatured ? "border-amber-500" : "border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <h5 className="font-medium text-white truncate">{product.name}</h5>
                <p className="text-sm text-gray-400">${product.priceUSD.toFixed(2)}</p>
              </div>
              {!product.isActive && (
                <Badge variant="outline" className="text-red-400 border-red-400/30 text-xs">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {product.quantity} in stock • {product.totalSold} sold
              </span>
              <div className="flex gap-1">
                <EditProductDialog product={product} onSuccess={() => refetch()} />
                <Button
                  variant={product.isFeatured ? "default" : "outline"}
                  size="sm"
                  className={product.isFeatured ? "bg-amber-600 hover:bg-amber-700 h-7 text-xs" : "h-7 text-xs"}
                  onClick={() => toggleProductFeatured.mutate({ productId: product.id, featured: !product.isFeatured })}
                  disabled={toggleProductFeatured.isPending}
                >
                  {product.isFeatured ? (
                    <>
                      <Star className="h-3 w-3 mr-1 fill-current" />
                      Featured
                    </>
                  ) : (
                    <>
                      <Star className="h-3 w-3 mr-1" />
                      Feature
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// FEATURED PRODUCTS TAB
// ============================================
function FeaturedProductsTab() {
  const { data, isLoading, refetch } = api.store.getAllStores.useQuery({
    status: "APPROVED",
    limit: 100,
  });

  const toggleProductFeatured = api.store.toggleProductFeatured.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const stores = data?.stores ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-lg">Featured Products</CardTitle>
          <CardDescription>
            Select products to feature on the mobile app home page. Featured products appear in the "Featured" section.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No active stores</p>
          ) : (
            <div className="space-y-6">
              {stores.map((store) => (
                <div key={store.id} className="border-b border-slate-800 pb-6 last:border-0">
                  <div className="flex items-center gap-2 mb-3">
                    <Store className="h-4 w-4 text-amber-500" />
                    <h3 className="font-medium text-white">{store.name}</h3>
                    {store.isScVerified && (
                      <Badge className="bg-amber-600 text-xs">SC Verified</Badge>
                    )}
                    <span className="text-sm text-gray-500">({store.productCount} products)</span>
                  </div>
                  {store.productCount > 0 && (
                    <StoreProductsForFeaturing storeId={store.id} onToggle={() => { /* empty */ }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StoreProductsForFeaturing({ storeId, onToggle }: { storeId: string; onToggle: () => void }) {
  const { data: products, isLoading, refetch } = api.store.getStoreProductsAdmin.useQuery({
    storeId,
    includeInactive: false,
  });

  const toggleProductFeatured = api.store.toggleProductFeatured.useMutation({
    onSuccess: () => {
      refetch();
      onToggle();
    },
  });

  if (isLoading) {
    return <div className="text-sm text-gray-400">Loading...</div>;
  }

  if (!products || products.length === 0) {
    return <div className="text-sm text-gray-400">No active products</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
      {products.map((product) => (
        <button
          key={product.id}
          onClick={() => toggleProductFeatured.mutate({ productId: product.id, featured: !product.isFeatured })}
          disabled={toggleProductFeatured.isPending}
          className={`p-3 rounded-lg border text-left transition-all ${
            product.isFeatured
              ? "bg-amber-600/20 border-amber-500 ring-1 ring-amber-500"
              : "bg-slate-800 border-slate-700 hover:border-slate-600"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white text-sm truncate">{product.name}</p>
              <p className="text-xs text-gray-400">${product.priceUSD.toFixed(2)}</p>
            </div>
            {product.isFeatured && (
              <Star className="h-4 w-4 text-amber-500 fill-amber-500 flex-shrink-0" />
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================
// APPLICATIONS TAB
// ============================================
function ApplicationsTab() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewNotes, setReviewNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | undefined>("PENDING");

  const { data, isLoading, error, refetch } = api.store.getStoreApplications.useQuery({
    status: statusFilter,
    limit: 50,
  });

  const applications = data?.stores ?? [];

  const approveStore = api.store.approveStore.useMutation({
    onSuccess: () => {
      setReviewNotes("");
      refetch();
      setCurrentIndex(0);
    },
    onError: (error) => {
      alert(`Error: ${error.message}`);
    },
  });

  const rejectStore = api.store.rejectStore.useMutation({
    onSuccess: () => {
      setRejectionReason("");
      refetch();
      setCurrentIndex(0);
    },
    onError: (error) => {
      alert(`Error: ${error.message}`);
    },
  });

  const handleApprove = () => {
    if (!currentApp) return;
    approveStore.mutate({
      storeId: currentApp.id,
      reviewNotes: reviewNotes || undefined,
    });
  };

  const handleReject = () => {
    if (!currentApp || !rejectionReason || rejectionReason.length < 10) {
      alert("Please provide a rejection reason (at least 10 characters)");
      return;
    }
    rejectStore.mutate({
      storeId: currentApp.id,
      rejectionReason,
    });
  };

  const statusTabs: { label: string; value: ApplicationStatus | undefined }[] = [
    { label: "Pending", value: "PENDING" },
    { label: "Under Review", value: "UNDER_REVIEW" },
    { label: "Approved", value: "APPROVED" },
    { label: "Rejected", value: "REJECTED" },
    { label: "All", value: undefined },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center h-[40vh] gap-4">
          <div className="text-red-500 text-center">
            <p className="font-semibold">Error loading applications</p>
            <p className="text-sm text-gray-400 mt-2">{error.message}</p>
          </div>
          <Button onClick={() => refetch()} variant="outline">
            Try Again
          </Button>
        </div>
        <ScVerificationApplicationsPanel />
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 bg-slate-800 rounded-lg p-1">
          {statusTabs.map((tab) => (
            <Button
              key={tab.label}
              onClick={() => {
                setStatusFilter(tab.value);
                setCurrentIndex(0);
              }}
              variant={statusFilter === tab.value ? "default" : "ghost"}
              size="sm"
              className={statusFilter === tab.value ? "bg-slate-700" : ""}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-col items-center justify-center h-[40vh] gap-4">
          <Store className="h-16 w-16 text-gray-600" />
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">No {statusFilter?.toLowerCase() || ""} Applications</h2>
            <p className="text-gray-400">
              {statusFilter === "PENDING"
                ? "All store applications have been reviewed!"
                : `No ${statusFilter?.toLowerCase().replace("_", " ") || ""} applications found.`}
            </p>
          </div>
        </div>
        <ScVerificationApplicationsPanel />
      </div>
    );
  }

  const safeIndex = Math.min(currentIndex, applications.length - 1);
  const currentApp = applications[safeIndex];
  const isPending = currentApp?.status === "PENDING" || currentApp?.status === "UNDER_REVIEW";

  return (
    <div className="space-y-4">
      {/* Status Tabs */}
      <div className="flex gap-2 bg-slate-800 rounded-lg p-1">
        {statusTabs.map((tab) => (
          <Button
            key={tab.label}
            onClick={() => {
              setStatusFilter(tab.value);
              setCurrentIndex(0);
            }}
            variant={statusFilter === tab.value ? "default" : "ghost"}
            size="sm"
            className={statusFilter === tab.value ? "bg-slate-700" : ""}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
        <Button
          onClick={() => {
            setCurrentIndex(currentIndex - 1);
            setReviewNotes("");
            setRejectionReason("");
          }}
          disabled={safeIndex === 0}
          variant="ghost"
          size="sm"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <span className="text-sm text-gray-400">
          {safeIndex + 1} / {applications.length}
        </span>
        <Button
          onClick={() => {
            setCurrentIndex(currentIndex + 1);
            setReviewNotes("");
            setRejectionReason("");
          }}
          disabled={safeIndex === applications.length - 1}
          variant="ghost"
          size="sm"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Application Card */}
      {currentApp && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-xl text-white flex items-center gap-2">
                  <Store className="h-5 w-5 text-amber-500" />
                  {currentApp.name}
                </CardTitle>
                <CardDescription className="mt-1">
                  {currentApp.category.replace(/_/g, " ")}
                  {currentApp.application?.websiteUrl && (
                    <a
                      href={currentApp.application.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-amber-500 hover:underline inline-flex items-center gap-1"
                    >
                      <Globe className="h-3 w-3" />
                      Website
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CardDescription>
              </div>
              <Badge
                className={
                  currentApp.status === "PENDING"
                    ? "bg-yellow-500/10 text-yellow-500"
                    : currentApp.status === "APPROVED"
                    ? "bg-green-500/10 text-green-500"
                    : currentApp.status === "REJECTED"
                    ? "bg-red-500/10 text-red-500"
                    : "bg-blue-500/10 text-blue-500"
                }
              >
                {currentApp.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Owner Info */}
            <div>
              <h4 className="font-medium text-amber-500 mb-2">Applicant</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-500">Name:</span> <span className="text-white">{currentApp.owner.name}</span></div>
                <div><span className="text-gray-500">Email:</span> <span className="text-white">{currentApp.owner.email}</span></div>
                <div><span className="text-gray-500">Phone:</span> <span className="text-white">{currentApp.owner.phone || "N/A"}</span></div>
                <div><span className="text-gray-500">Applied:</span> <span className="text-white">{new Date(currentApp.createdAt).toLocaleDateString()}</span></div>
              </div>
            </div>

            {/* Store Description */}
            {currentApp.application?.storeDescription && (
              <div>
                <h4 className="font-medium text-amber-500 mb-2">Store Description</h4>
                <p className="text-sm text-gray-300 bg-slate-800 p-3 rounded-lg">
                  {currentApp.application.storeDescription}
                </p>
              </div>
            )}

            {/* Community Benefit */}
            {currentApp.application?.communityBenefitStatement && (
              <div>
                <h4 className="font-medium text-amber-500 mb-2">Community Benefit Statement</h4>
                <p className="text-sm text-gray-300 bg-slate-800 p-3 rounded-lg">
                  {currentApp.application.communityBenefitStatement}
                </p>
              </div>
            )}

            {/* Actions for pending */}
            {isPending && (
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <div>
                  <Label>Review Notes (optional)</Label>
                  <Textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Notes for this review..."
                    className="mt-1 bg-slate-800 border-slate-700"
                  />
                </div>

                <div>
                  <Label>Rejection Reason (required if rejecting)</Label>
                  <Textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Reason for rejection (min 10 chars)..."
                    className="mt-1 bg-slate-800 border-slate-700"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleReject}
                    disabled={rejectStore.isPending || approveStore.isPending}
                    variant="outline"
                    className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                  <Button
                    onClick={handleApprove}
                    disabled={approveStore.isPending || rejectStore.isPending}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <ScVerificationApplicationsPanel />
    </div>
  );
}

function ScVerificationApplicationsPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data, isLoading, refetch } = api.scVerification.listApplications.useQuery({
    limit: 50,
  });

  const reviewApplication = api.scVerification.reviewApplication.useMutation({
    onSuccess: () => {
      setRejectionReason("");
      setSelectedId(null);
      refetch();
    },
  });

  const applications = data?.applications ?? [];
  const selected = applications.find((application: any) => application.id === selectedId) ?? applications[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">SC Verification Queue</h2>
          <p className="text-sm text-gray-400">Stripe approval gets stores live. SC verification is reviewed separately here.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} className="border-slate-700">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : applications.length === 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-6 text-sm text-gray-400">
            No SC verification applications yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px,1fr]">
          <div className="space-y-2">
            {applications.map((application: any) => (
              <button
                key={application.id}
                type="button"
                onClick={() => setSelectedId(application.id)}
                className={`w-full rounded-lg border p-3 text-left ${
                  selected?.id === application.id ? "border-amber-500 bg-amber-500/10" : "border-slate-800 bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{application.store.name}</p>
                    <p className="text-xs text-gray-400">{application.store.owner.email}</p>
                  </div>
                  <Badge className={
                    application.status === "PENDING"
                      ? "bg-yellow-500/10 text-yellow-400"
                      : application.status === "APPROVED"
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  }>
                    {application.status}
                  </Badge>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                  {selected.store.name}
                </CardTitle>
                <CardDescription>
                  Stripe status: {selected.store.stripeAccount?.onboardingStatus || "No account"} · Charges enabled: {selected.store.stripeAccount?.chargesEnabled ? "Yes" : "No"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-medium text-amber-500 mb-2">Why SC Eligible</h4>
                  <p className="text-sm text-gray-300 bg-slate-800 p-3 rounded-lg">{selected.whyScEligible}</p>
                </div>
                <div>
                  <h4 className="font-medium text-amber-500 mb-2">Expected Volume</h4>
                  <p className="text-sm text-gray-300 bg-slate-800 p-3 rounded-lg">{selected.expectedVolume}</p>
                </div>
                {selected.status !== "APPROVED" && (
                  <>
                    <div>
                      <Label>Rejection Reason (required if rejecting)</Label>
                      <Textarea
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="Reason for rejection..."
                        className="mt-1 bg-slate-800 border-slate-700"
                      />
                    </div>
                    <div className="flex gap-3">
                      <Button
                        onClick={() => {
                          if (rejectionReason.trim().length < 10) {
                            alert("Please provide a rejection reason with at least 10 characters.");
                            return;
                          }
                          reviewApplication.mutate({
                            applicationId: selected.id,
                            approve: false,
                            rejectionReason,
                          });
                        }}
                        disabled={reviewApplication.isPending}
                        variant="outline"
                        className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10"
                      >
                        Reject
                      </Button>
                      <Button
                        onClick={() => reviewApplication.mutate({ applicationId: selected.id, approve: true })}
                        disabled={reviewApplication.isPending}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        Approve SC
                      </Button>
                    </div>
                  </>
                )}
                {selected.status === "APPROVED" && (
                  <Badge className="bg-green-500/10 text-green-400">SC verification approved</Badge>
                )}
                {selected.status === "REJECTED" && selected.rejectionReason && (
                  <p className="text-sm text-red-400">{selected.rejectionReason}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// STORE ON-CHAIN STATUS PANEL
// ============================================
function StoreOnChainStatusPanel({
  storeId,
  onFixApplied,
}: {
  storeId: string;
  onFixApplied: () => void;
}) {
  const [checked, setChecked] = useState(false);

  const { data, isLoading, refetch } = api.store.checkStoreOnChainStatus.useQuery(
    { storeId },
    { enabled: checked }
  );

  const toggleScVerification = api.store.toggleScVerification.useMutation({
    onSuccess: () => {
      refetch();
      onFixApplied();
    },
  });

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-white flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" />
          On-Chain vs Database Status
        </h4>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setChecked(true); refetch(); }}
          disabled={isLoading}
          className="border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 text-xs h-7"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Check Chain
        </Button>
      </div>

      {!checked && !data && (
        <p className="text-xs text-gray-500">Click "Check Chain" to compare database vs on-chain verification status.</p>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Querying blockchain...
        </div>
      )}

      {data && !isLoading && (
        <div className="space-y-3">
          {/* Status comparison row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded bg-slate-800 px-3 py-2">
              <p className="text-xs text-gray-400 mb-1">Database</p>
              {data.dbVerified ? (
                <span className="flex items-center gap-1 text-sm text-green-400 font-medium">
                  <CheckCircle2 className="h-4 w-4" /> SC Verified
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-gray-400 font-medium">
                  <XCircle className="h-4 w-4" /> Not Verified
                </span>
              )}
            </div>
            <div className="rounded bg-slate-800 px-3 py-2">
              <p className="text-xs text-gray-400 mb-1">On-Chain</p>
              {data.error ? (
                <span className="flex items-center gap-1 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4" /> {data.error}
                </span>
              ) : data.onChainVerified ? (
                <span className="flex items-center gap-1 text-sm text-green-400 font-medium">
                  <CheckCircle2 className="h-4 w-4" /> SC Verified
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-gray-400 font-medium">
                  <XCircle className="h-4 w-4" /> Not Verified
                </span>
              )}
            </div>
          </div>

          {/* Sync status + wallet */}
          {data.ownerWallet && (
            <p className="text-xs text-gray-500 font-mono truncate">
              Owner wallet: {data.ownerWallet}
            </p>
          )}

          {/* In sync / out of sync indicator */}
          {!data.error && (
            data.inSync ? (
              <div className="flex items-center gap-2 rounded bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs text-green-400">
                <Link2 className="h-3 w-3 shrink-0" />
                In sync — database and on-chain status match
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
                  <Link2Off className="h-3 w-3 shrink-0" />
                  Out of sync — database says <strong className="ml-1">{data.dbVerified ? 'verified' : 'not verified'}</strong>
                  , chain says <strong className="ml-1">{data.onChainVerified ? 'verified' : 'not verified'}</strong>
                </div>
                <div className="flex gap-2">
                  {data.dbVerified && !data.onChainVerified && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                      disabled={toggleScVerification.isPending}
                      onClick={() => toggleScVerification.mutate({ storeId, verified: true })}
                    >
                      {toggleScVerification.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                      Push Verification to Chain
                    </Button>
                  )}
                  {!data.dbVerified && data.onChainVerified && (
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                      disabled={toggleScVerification.isPending}
                      onClick={() => toggleScVerification.mutate({ storeId, verified: false })}
                    >
                      {toggleScVerification.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <XCircle className="h-3 w-3 mr-1" />}
                      Remove from Chain
                    </Button>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// STORE SC REWARDS PANEL
// ============================================
function StoreSCRewardsPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const coin = useCoin();
  const { data, isLoading, error } = api.scRewards.getSCRewardsForStore.useQuery({
    storeId,
    limit: 10,
  });

  if (isLoading) {
    return (
      <div className="bg-slate-800 rounded-lg p-4">
        <h4 className="font-medium text-white mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          {coin.symbol} Rewards
        </h4>
        <div className="py-4 text-center text-gray-400">Loading {coin.symbol} rewards...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800 rounded-lg p-4">
        <h4 className="font-medium text-white mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          {coin.symbol} Rewards
        </h4>
        <div className="py-4 text-center">
          <p className="text-red-400 mb-2">Error loading {coin.symbol} rewards</p>
          <p className="text-sm text-gray-500">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data || data.rewards.length === 0) {
    return (
      <div className="bg-slate-800 rounded-lg p-4">
        <h4 className="font-medium text-white mb-3 flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          {coin.symbol} Rewards
        </h4>
        <div className="py-4 text-center text-gray-400">No {coin.symbol} rewards distributed yet</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-white flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          SC Rewards
        </h4>
        <a
          href={`/portal/sc-rewards?storeId=${storeId}`}
          className="text-sm text-amber-400 hover:text-amber-300"
        >
          View All →
        </a>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-slate-900 rounded-lg">
        <div>
          <p className="text-xs text-gray-400">Total Distributed</p>
          <p className="text-lg font-bold text-amber-400">{data.totalDistributed.toFixed(2)} SC</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Total Rewards</p>
          <p className="text-lg font-bold text-white">{data.totalCount}</p>
        </div>
      </div>

      <div className="space-y-2">
        {data.rewards.slice(0, 5).map((reward) => (
          <div
            key={reward.id}
            className="flex items-center justify-between p-2 bg-slate-900 rounded"
          >
            <div className="flex-1">
              <p className="text-sm text-white">{reward.user.name || reward.user.email}</p>
              <p className="text-xs text-gray-500">
                {reward.reason === 'STORE_PURCHASE_REWARD' ? 'Purchase' : 'Sale'} •{' '}
                {new Date(reward.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-amber-400">
                {reward.amountSC.toFixed(4)} SC
              </p>
              <Badge
                className={
                  reward.status === 'COMPLETED'
                    ? 'bg-green-500/10 text-green-500 text-xs'
                    : reward.status === 'FAILED'
                    ? 'bg-red-500/10 text-red-500 text-xs'
                    : 'bg-yellow-500/10 text-yellow-500 text-xs'
                }
              >
                {reward.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// STORE STATUS ACTIONS (DISABLE/DELETE)
// ============================================
function StoreStatusActions({ 
  storeId, 
  currentStatus, 
  isDeleted,
  onSuccess 
}: { 
  storeId: string; 
  currentStatus: string;
  isDeleted: boolean;
  onSuccess: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [action, setAction] = useState<'suspend' | 'delete' | 'restore' | null>(null);

  const updateStatus = api.store.updateStoreStatus.useMutation({
    onSuccess: () => {
      setShowConfirm(false);
      setAction(null);
      onSuccess();
    },
  });

  const handleAction = (actionType: 'suspend' | 'delete' | 'restore') => {
    setAction(actionType);
    setShowConfirm(true);
  };

  const confirmAction = () => {
    if (!action) return;
    
    if (action === 'suspend') {
      updateStatus.mutate({ 
        storeId, 
        status: currentStatus === 'SUSPENDED' ? 'APPROVED' : 'SUSPENDED' 
      });
    } else if (action === 'restore') {
      updateStatus.mutate({ 
        storeId, 
        status: 'APPROVED' 
      });
    } else if (action === 'delete') {
      updateStatus.mutate({ 
        storeId, 
        status: 'REJECTED' 
      });
    }
  };

  if (showConfirm) {
    return (
      <div className="flex gap-2 items-center">
        <span className="text-sm text-gray-400">
          {action === 'suspend' 
            ? currentStatus === 'SUSPENDED' 
              ? 'Enable store?' 
              : 'Disable store?'
            : action === 'restore'
              ? 'Restore store?'
              : 'Soft delete store?'}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setShowConfirm(false);
            setAction(null);
          }}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={confirmAction}
          disabled={updateStatus.isPending}
          className="h-7 text-xs bg-red-600 hover:bg-red-700"
        >
          {updateStatus.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            'Confirm'
          )}
        </Button>
      </div>
    );
  }

  return (
    <>
      {isDeleted && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleAction('restore')}
          className="border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
        >
          <CheckCircle2 className="h-4 w-4 mr-1" />
          Restore Store
        </Button>
      )}
      {!isDeleted && (
        <>
          {currentStatus !== 'SUSPENDED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction('suspend')}
              className="border-orange-600 text-orange-600 hover:bg-orange-600 hover:text-white"
            >
              <Ban className="h-4 w-4 mr-1" />
              Disable Store
            </Button>
          )}
          {currentStatus === 'SUSPENDED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction('suspend')}
              className="border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Enable Store
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleAction('delete')}
            className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Soft Delete Store
          </Button>
        </>
      )}
    </>
  );
}

// ============================================
// STRIPE CONNECT STATUS PANEL
// ============================================
function StripeConnectStatusPanel({ store }: { store: any }) {
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [businessType, setBusinessType] = useState<"individual" | "company">("company");
  const [showSetupForm, setShowSetupForm] = useState(false);

  const syncStatus = api.stripeConnect.syncStatus.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  const initiateOnboarding = api.stripeConnect.adminInitiateOnboarding.useMutation({
    onSuccess: (data) => {
      setOnboardingUrl(data.onboardingUrl);
      setShowSetupForm(false);
    },
  });

  const handleSync = () => {
    if (!store.stripeAccount) return;
    syncStatus.mutate({
      userId: store.ownerId,
      businessId: store.stripeAccount.businessId,
    });
  };

  const handleInitiate = () => {
    initiateOnboarding.mutate({
      storeId: store.id,
      businessType,
      returnUrl: window.location.href,
      refreshUrl: window.location.href,
    });
  };

  const handleCopy = () => {
    if (!onboardingUrl) return;
    navigator.clipboard.writeText(onboardingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const OnboardingLinkResult = () => (
    <div className="mt-3 bg-slate-800 rounded p-3 space-y-2">
      <p className="text-xs text-gray-400 font-medium">Onboarding link generated — share with store owner:</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs text-blue-300 bg-slate-900 rounded px-2 py-1 truncate">
          {onboardingUrl}
        </code>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCopy}
          className="border border-slate-600 text-gray-300 hover:bg-slate-700 text-xs h-7 shrink-0"
        >
          {copied ? <CheckCircle2 className="h-3 w-3 mr-1 text-green-400" /> : <ExternalLink className="h-3 w-3 mr-1" />}
          {copied ? "Copied!" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => window.open(onboardingUrl!, "_blank")}
          className="border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-7 shrink-0"
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Open
        </Button>
      </div>
      <p className="text-xs text-gray-500">Link expires after use. Generate a new one if needed.</p>
    </div>
  );

  if (!store.stripeAccount) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-gray-400" />
            <h4 className="text-sm font-medium text-white">Stripe Connect Status</h4>
          </div>
          {!showSetupForm && !onboardingUrl && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSetupForm(true)}
              className="border border-green-500/40 text-green-400 hover:bg-green-500/10 text-xs h-7"
            >
              <Link2 className="h-3 w-3 mr-1" />
              Setup Stripe Connect
            </Button>
          )}
        </div>

        {!onboardingUrl && !showSetupForm && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-gray-400">No Stripe Connect account set up yet</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Store owner needs to complete Stripe Connect onboarding to accept payments.
            </p>
          </>
        )}

        {showSetupForm && (
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Business type</label>
              <div className="flex gap-2">
                {(["company", "individual"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setBusinessType(t)}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                      businessType === t
                        ? "border-green-500 bg-green-500/10 text-green-400"
                        : "border-slate-600 text-gray-400 hover:border-slate-500"
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {store.owner?.email && (
              <p className="text-xs text-gray-500">
                Owner email: <span className="text-gray-300">{store.owner.email}</span>
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleInitiate}
                disabled={initiateOnboarding.isPending}
                className="bg-green-600 hover:bg-green-700 text-white text-xs h-7"
              >
                {initiateOnboarding.isPending ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3 mr-1" />
                )}
                Create Account & Get Link
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSetupForm(false)}
                className="border border-slate-600 text-gray-400 text-xs h-7"
              >
                Cancel
              </Button>
            </div>
            {initiateOnboarding.isError && (
              <p className="text-xs text-red-400">{initiateOnboarding.error.message}</p>
            )}
          </div>
        )}

        {onboardingUrl && <OnboardingLinkResult />}
      </div>
    );
  }

  const { stripeAccount } = store;
  const hasIssues = stripeAccount.requirementsCurrentlyDue?.length > 0 ||
                    stripeAccount.requirementsPastDue?.length > 0;
  const needsOnboarding = !stripeAccount.chargesEnabled;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-400" />
          <h4 className="text-sm font-medium text-white">Stripe Connect Status</h4>
        </div>
        <div className="flex gap-2">
          {needsOnboarding && !onboardingUrl && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleInitiate}
              disabled={initiateOnboarding.isPending}
              className="border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 text-xs h-7"
            >
              {initiateOnboarding.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Link2 className="h-3 w-3 mr-1" />
              )}
              Get Onboarding Link
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(`https://dashboard.stripe.com/${env.NEXT_PUBLIC_STRIPE_MODE === 'live' ? '' : 'test/'}connect/accounts/${stripeAccount.stripeAccountId}`, '_blank')}
            className="border border-purple-500/40 text-purple-400 hover:bg-purple-500/10 text-xs h-7"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View in Stripe
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSync}
            disabled={syncStatus.isPending}
            className="border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs h-7"
          >
            {syncStatus.isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            Sync Status
          </Button>
        </div>
      </div>

      {onboardingUrl && <OnboardingLinkResult />}

      {/* Status Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-slate-800 rounded p-2">
          <p className="text-xs text-gray-400 mb-1">Onboarding</p>
          <Badge className={
            stripeAccount.onboardingStatus === 'COMPLETE' 
              ? 'bg-green-500/10 text-green-400'
              : stripeAccount.onboardingStatus === 'RESTRICTED'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-yellow-500/10 text-yellow-400'
          }>
            {stripeAccount.onboardingStatus || 'UNKNOWN'}
          </Badge>
        </div>
        <div className="bg-slate-800 rounded p-2">
          <p className="text-xs text-gray-400 mb-1">Verification</p>
          <Badge className={
            stripeAccount.verificationStatus === 'VERIFIED' 
              ? 'bg-green-500/10 text-green-400'
              : stripeAccount.verificationStatus === 'REJECTED'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-yellow-500/10 text-yellow-400'
          }>
            {stripeAccount.verificationStatus || 'UNVERIFIED'}
          </Badge>
        </div>
      </div>

      {/* Capabilities */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex items-center gap-1 text-xs">
          {stripeAccount.detailsSubmitted ? (
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          ) : (
            <XCircle className="h-3 w-3 text-gray-500" />
          )}
          <span className={stripeAccount.detailsSubmitted ? 'text-green-400' : 'text-gray-500'}>
            Details
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {stripeAccount.chargesEnabled ? (
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          ) : (
            <XCircle className="h-3 w-3 text-gray-500" />
          )}
          <span className={stripeAccount.chargesEnabled ? 'text-green-400' : 'text-gray-500'}>
            Charges
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {stripeAccount.payoutsEnabled ? (
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          ) : (
            <XCircle className="h-3 w-3 text-gray-500" />
          )}
          <span className={stripeAccount.payoutsEnabled ? 'text-green-400' : 'text-gray-500'}>
            Payouts
          </span>
        </div>
      </div>

      {/* Requirements / Issues */}
      {hasIssues && (
        <div className="bg-red-900/20 border border-red-500/30 rounded p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-400 mb-1">Action Required</p>
              {stripeAccount.requirementsPastDue?.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-red-300 font-medium mb-1">Past Due:</p>
                  <ul className="text-xs text-red-300 space-y-0.5 ml-4">
                    {stripeAccount.requirementsPastDue.map((req: string, i: number) => (
                      <li key={i} className="list-disc">{req.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stripeAccount.requirementsCurrentlyDue?.length > 0 && (
                <div>
                  <p className="text-xs text-yellow-300 font-medium mb-1">Currently Due:</p>
                  <ul className="text-xs text-yellow-300 space-y-0.5 ml-4">
                    {stripeAccount.requirementsCurrentlyDue.map((req: string, i: number) => (
                      <li key={i} className="list-disc">{req.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {/* Verification Rejected */}
        {stripeAccount.verificationStatus === 'REJECTED' && (
          <div className="bg-red-900/20 border border-red-500/30 rounded p-3 mt-3">
            <div className="flex items-start gap-2">
              <XCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400 mb-1">Verification Rejected</p>
                {stripeAccount.disabledReason && (
                  <p className="text-xs text-red-300 mb-2 font-mono bg-red-950/30 p-2 rounded">
                    Reason: {stripeAccount.disabledReason.replace(/_/g, ' ')}
                  </p>
                )}
                <p className="text-xs text-red-300">
                  Stripe has rejected this account's verification. The store owner needs to contact Stripe support or resubmit with corrected information.
                </p>
              </div>
            </div>
          </div>
        )}

      {/* Success State */}
      {stripeAccount.chargesEnabled && stripeAccount.payoutsEnabled && !hasIssues && (
        <div className="bg-green-900/20 border border-green-500/30 rounded p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            <p className="text-sm text-green-400">
              Fully operational - can accept payments and receive payouts
            </p>
          </div>
        </div>
      )}

      {/* Account ID */}
      <p className="text-xs text-gray-500 mt-3 font-mono">
        Account: {stripeAccount.stripeAccountId}
      </p>
    </div>
  );
}
