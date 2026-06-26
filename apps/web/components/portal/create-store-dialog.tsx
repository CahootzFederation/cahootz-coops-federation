"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, ShieldCheck } from "lucide-react";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { BlobImageUpload } from "./blob-image-upload";
import { Switch } from "@/components/ui/switch";

interface CreateStoreDialogProps {
  coopId: string;
  onSuccess?: () => void;
}

export function CreateStoreDialog({ coopId, onSuccess }: CreateStoreDialogProps) {
  const { address } = useWeb3Auth();
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [isScVerified, setIsScVerified] = useState(false);

  const { data: currentUser } = api.user.getUserByWallet.useQuery(
    { walletAddress: address || "" },
    { enabled: !!address }
  );

  const { data: categories, isLoading: loadingCategories } = api.categories.getStoreCategories.useQuery({
    includeAdminOnly: true,
  });

  const createStore = api.store.createStoreAdmin.useMutation({
    onSuccess: () => {
      setOpen(false);
      resetForm();
      onSuccess?.();
    },
  });

  useEffect(() => {
    if (currentUser?.id && !ownerId) {
      setOwnerId(currentUser.id);
    }
  }, [currentUser, ownerId]);

  const resetForm = () => {
    setOwnerId(currentUser?.id || "");
    setName("");
    setDescription("");
    setCategory("");
    setImageUrl("");
    setBannerUrl("");
    setIsScVerified(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createStore.mutate({
      ownerId,
      name,
      description: description || undefined,
      category: category,
      imageUrl: imageUrl || undefined,
      bannerUrl: bannerUrl || undefined,
      isScVerified,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-amber-600 hover:bg-amber-700">
          <Plus className="h-4 w-4 mr-2" />
          Create Store
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white">Create New Store</DialogTitle>
          <DialogDescription className="text-gray-400">
            Create a store for an existing user (admin only)
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ownerId" className="text-gray-300">
              Owner User ID *
            </Label>
            <Input
              id="ownerId"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="Enter user ID"
              required
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div>
            <Label htmlFor="name" className="text-gray-300">
              Store Name *
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter store name"
              required
              className="bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div>
            <Label htmlFor="description" className="text-gray-300">
              Description
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter store description"
              className="bg-slate-800 border-slate-700 text-white"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="category" className="text-gray-300">
              Category *
            </Label>
            <Select value={category} onValueChange={setCategory} required>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {loadingCategories ? (
                  <div className="p-2 text-center text-gray-400">Loading...</div>
                ) : (
                  categories?.map((cat) => (
                    <SelectItem key={cat.key} value={cat.key} className="text-white">
                      {cat.label}
                      {cat.isAdminOnly && " (Admin Only)"}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <BlobImageUpload
              uploadType="store"
              coopId={coopId}
              resourceId={ownerId}
              label="Store Image (Optional)"
              description="Upload a logo or main image for the store"
              aspectRatio="aspect-square"
              onUploadComplete={(url) => setImageUrl(url)}
            />
          </div>

          <div>
            <BlobImageUpload
              uploadType="store"
              coopId={coopId}
              resourceId={ownerId}
              label="Store Banner (Optional)"
              description="Upload a wide banner image for the store"
              aspectRatio="aspect-video"
              onUploadComplete={(url) => setBannerUrl(url)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-amber-600/30 bg-amber-600/10 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <div>
                <p className="text-sm font-medium text-white">SC Verified</p>
                <p className="text-xs text-gray-400">Mark as Cahootz co-op verified (DB only, no blockchain)</p>
              </div>
            </div>
            <Switch
              checked={isScVerified}
              onCheckedChange={setIsScVerified}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-slate-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createStore.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {createStore.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Store"
              )}
            </Button>
          </div>

          {createStore.error && (
            <p className="text-red-400 text-sm">{createStore.error.message}</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
