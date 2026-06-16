"use client";

import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import { Geocoder } from "@mapbox/search-js-react";
import { useParams } from "next/navigation";
import {
  Building2,
  CheckCircle,
  ExternalLink,
  Lightbulb,
  MapPin,
  Plus,
  Store,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { env } from "@/env";
import { api } from "@/lib/trpc/client";

interface BusinessFormState {
  id?: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  formattedAddress: string;
  placeId: string;
  latitude: string;
  longitude: string;
  phone: string;
  email: string;
  website: string;
  tags: string;
  isFeatured: boolean;
  isActive: boolean;
}

const emptyBusiness: BusinessFormState = {
  name: "",
  category: "",
  description: "",
  imageUrl: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  formattedAddress: "",
  placeId: "",
  latitude: "",
  longitude: "",
  phone: "",
  email: "",
  website: "",
  tags: "",
  isFeatured: false,
  isActive: true,
};

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formFromBusiness(business: any): BusinessFormState {
  return {
    id: business.id,
    name: business.name || "",
    category: business.category || "",
    description: business.description || "",
    imageUrl: business.imageUrl || "",
    address: business.address || "",
    city: business.city || "",
    state: business.state || "",
    zipCode: business.zipCode || "",
    formattedAddress: business.formattedAddress || "",
    placeId: business.placeId || "",
    latitude: business.latitude == null ? "" : String(business.latitude),
    longitude: business.longitude == null ? "" : String(business.longitude),
    phone: business.phone || "",
    email: business.email || "",
    website: business.website || "",
    tags: business.tags?.join(", ") || "",
    isFeatured: Boolean(business.isFeatured),
    isActive: Boolean(business.isActive),
  };
}

function payloadFromForm(form: BusinessFormState) {
  return {
    name: form.name,
    category: nullable(form.category),
    description: nullable(form.description),
    imageUrl: nullable(form.imageUrl),
    address: nullable(form.address),
    city: nullable(form.city),
    state: nullable(form.state),
    zipCode: nullable(form.zipCode),
    formattedAddress: nullable(form.formattedAddress),
    placeId: nullable(form.placeId),
    latitude: form.latitude.trim() ? Number(form.latitude) : null,
    longitude: form.longitude.trim() ? Number(form.longitude) : null,
    phone: nullable(form.phone),
    email: nullable(form.email),
    website: nullable(form.website),
    tags: parseTags(form.tags),
    isFeatured: form.isFeatured,
    isActive: form.isActive,
  };
}

function hasSelectedLocation(form: BusinessFormState) {
  return Boolean(
    form.placeId.trim() &&
      form.formattedAddress.trim() &&
      form.latitude.trim() &&
      form.longitude.trim(),
  );
}

interface PlaceSelection {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  formattedAddress: string;
  placeId: string;
  latitude: string;
  longitude: string;
  name?: string;
}

type GeocoderFeature = NonNullable<ComponentProps<typeof Geocoder>["onRetrieve"]> extends (feature: infer Feature) => void
  ? Feature
  : never;

function mapboxPlaceSelection(feature: GeocoderFeature): PlaceSelection | null {
  const [longitude, latitude] = feature.geometry.coordinates;
  const { context, coordinates } = feature.properties;
  const city =
    context.place?.name ||
    context.locality?.name ||
    context.district?.name ||
    "";

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    address: feature.properties.name || feature.properties.full_address || "",
    city,
    state: context.region?.name || "",
    zipCode: context.postcode?.name || "",
    formattedAddress: feature.properties.full_address || [
      feature.properties.name,
      feature.properties.place_formatted,
    ].filter(Boolean).join(", "),
    placeId: feature.properties.mapbox_id || feature.id || "",
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    name: feature.properties.feature_type === "address" ? undefined : feature.properties.name,
  };
}

function DirectoryPlaceInput({
  value,
  selectedLabel,
  onSearchChange,
  onPlaceSelect,
}: {
  value: string;
  selectedLabel: string;
  onSearchChange: (value: string) => void;
  onPlaceSelect: (selection: PlaceSelection) => void;
}) {
  const accessToken = env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  return (
    <div>
      {accessToken ? (
        <div className="rounded-md border border-slate-700 bg-slate-950">
          <Geocoder
            accessToken={accessToken}
            value={value}
            onChange={onSearchChange}
            onRetrieve={(feature) => {
              const selection = mapboxPlaceSelection(feature);
              if (selection) onPlaceSelect(selection);
            }}
            placeholder="Search for an address"
            options={{
              autocomplete: true,
              country: "US",
              language: "en",
              limit: 6,
              permanent: true,
              types: "address,street,place,locality",
            }}
            theme={{
              variables: {
                border: "0",
                borderRadius: "0.375rem",
                boxShadow: "none",
                colorBackground: "#020617",
                colorBackgroundHover: "#0f172a",
                colorBackgroundActive: "#1e293b",
                colorText: "#ffffff",
                colorSecondary: "#94a3b8",
                colorPrimary: "#f59e0b",
                fontFamily: "inherit",
                unit: "14px",
              },
            }}
          />
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-400">
          Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to choose directory locations.
        </div>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {accessToken
          ? "Choose a suggested Mapbox location. Typed addresses cannot be saved unless a suggestion is selected."
          : "Directory businesses require a Mapbox-selected location before they can be saved."}
      </p>
      {selectedLabel && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
          <MapPin className="h-3 w-3" />
          Location selected
        </p>
      )}
    </div>
  );
}

export default function AppsPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const [requestTitle, setRequestTitle] = useState("");
  const [requestDescription, setRequestDescription] = useState("");
  const [businessForm, setBusinessForm] = useState<BusinessFormState>(emptyBusiness);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const appsQuery = api.coopApps.listForAdmin.useQuery({ coopId });
  const directoryQuery = api.directory.listAdmin.useQuery({ coopId });

  const updateSetting = api.coopApps.updateSetting.useMutation({
    onSuccess: () => {
      void appsQuery.refetch();
      setSavedMessage("App settings updated");
      setTimeout(() => setSavedMessage(null), 2500);
    },
  });

  const createRequest = api.coopApps.createRequest.useMutation({
    onSuccess: () => {
      setRequestTitle("");
      setRequestDescription("");
      void appsQuery.refetch();
      setSavedMessage("App request submitted");
      setTimeout(() => setSavedMessage(null), 2500);
    },
  });

  const createBusiness = api.directory.create.useMutation({
    onSuccess: () => {
      setBusinessForm(emptyBusiness);
      void directoryQuery.refetch();
      setSavedMessage("Directory business added");
      setTimeout(() => setSavedMessage(null), 2500);
    },
  });

  const updateBusiness = api.directory.update.useMutation({
    onSuccess: () => {
      setBusinessForm(emptyBusiness);
      void directoryQuery.refetch();
      setSavedMessage("Directory business updated");
      setTimeout(() => setSavedMessage(null), 2500);
    },
  });

  const deleteBusiness = api.directory.delete.useMutation({
    onSuccess: () => {
      void directoryQuery.refetch();
      setSavedMessage("Directory business deleted");
      setTimeout(() => setSavedMessage(null), 2500);
    },
  });

  const handleBusinessSubmit = () => {
    const data = payloadFromForm(businessForm);
    if (!data.name.trim()) return;
    if (!hasSelectedLocation(businessForm)) {
      setSavedMessage("Choose a suggested location before saving");
      setTimeout(() => setSavedMessage(null), 2500);
      return;
    }

    if (businessForm.id) {
      updateBusiness.mutate({ coopId, id: businessForm.id, data });
    } else {
      createBusiness.mutate({ coopId, data });
    }
  };

  const handleLocationSearchChange = useCallback((address: string) => {
    setBusinessForm((form) => ({
      ...form,
      address,
      city: "",
      state: "",
      zipCode: "",
      formattedAddress: "",
      placeId: "",
      latitude: "",
      longitude: "",
    }));
  }, []);

  const handlePlaceSelect = useCallback((selection: PlaceSelection) => {
    setBusinessForm((form) => ({
      ...form,
      name: form.name || selection.name || "",
      address: selection.address,
      city: selection.city,
      state: selection.state,
      zipCode: selection.zipCode,
      formattedAddress: selection.formattedAddress,
      placeId: selection.placeId,
      latitude: selection.latitude,
      longitude: selection.longitude,
    }));
  }, []);

  const isSavingBusiness = createBusiness.isPending || updateBusiness.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Apps</h1>
          <p className="mt-1 text-gray-400">
            Manage public and mobile apps for this coop
          </p>
        </div>
        {savedMessage && (
          <Badge className="w-fit border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
            <CheckCircle className="mr-1 h-3 w-3" />
            {savedMessage}
          </Badge>
        )}
      </div>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="text-white">Available Apps</CardTitle>
          <CardDescription>
            Marketplace is always on. Directory can be shown or hidden on public and mobile surfaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {appsQuery.data?.apps.map((app) => {
            const Icon = app.key === "directory" ? MapPin : Store;
            return (
              <div
                key={app.key}
                className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-[1fr_auto]"
              >
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-white">{app.name}</h2>
                      {app.locked && <Badge variant="secondary">Always on</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{app.description}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 md:min-w-64">
                  <label className="flex items-center justify-between gap-3 rounded-md border border-slate-800 px-3 py-2 text-sm text-gray-300">
                    Public page
                    <Switch
                      checked={app.publicEnabled}
                      disabled={app.locked || updateSetting.isPending}
                      onCheckedChange={(checked) =>
                        updateSetting.mutate({
                          coopId,
                          appKey: app.key,
                          publicEnabled: checked,
                        })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-slate-800 px-3 py-2 text-sm text-gray-300">
                    Mobile
                    <Switch
                      checked={app.memberEnabled}
                      disabled={app.locked || updateSetting.isPending}
                      onCheckedChange={(checked) =>
                        updateSetting.mutate({
                          coopId,
                          appKey: app.key,
                          memberEnabled: checked,
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Lightbulb className="h-5 w-5 text-amber-300" />
            Requested Apps
          </CardTitle>
          <CardDescription>
            Submit ideas for apps or features this coop wants next.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div>
              <Label className="text-gray-300">App or feature idea</Label>
              <Input
                className="mt-1 border-slate-700 bg-slate-950 text-white"
                value={requestTitle}
                onChange={(event) => setRequestTitle(event.target.value)}
                placeholder="Public roadmap, discussion board, hiring board..."
              />
            </div>
            <div>
              <Label className="text-gray-300">Notes</Label>
              <Textarea
                className="mt-1 border-slate-700 bg-slate-950 text-white"
                value={requestDescription}
                onChange={(event) => setRequestDescription(event.target.value)}
                placeholder="Describe what the coop needs this app to do."
              />
            </div>
            <Button
              onClick={() =>
                createRequest.mutate({
                  coopId,
                  title: requestTitle,
                  description: requestDescription || undefined,
                })
              }
              disabled={createRequest.isPending || requestTitle.trim().length < 2}
              className="bg-amber-500 text-white hover:bg-amber-600"
            >
              Submit Request
            </Button>
          </div>
          <div className="space-y-3">
            {appsQuery.data?.requests.length ? (
              appsQuery.data.requests.map((request) => (
                <div key={request.id} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{request.title}</p>
                      {request.description && (
                        <p className="mt-1 text-sm text-gray-400">{request.description}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-gray-300">
                      {request.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-gray-400">
                No app requests yet.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Building2 className="h-5 w-5 text-emerald-300" />
            Directory Businesses
          </CardTitle>
          <CardDescription>
            Add local businesses that should appear in the Directory app.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="font-semibold text-white">
              {businessForm.id ? "Edit business" : "Add business"}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <Label className="text-gray-300">Name</Label>
                <Input
                  className="mt-1 border-slate-700 bg-slate-950 text-white"
                  value={businessForm.name}
                  onChange={(event) => setBusinessForm((form) => ({ ...form, name: event.target.value }))}
                />
              </div>
              <div>
                <Label className="text-gray-300">Category</Label>
                <Input
                  className="mt-1 border-slate-700 bg-slate-950 text-white"
                  value={businessForm.category}
                  onChange={(event) => setBusinessForm((form) => ({ ...form, category: event.target.value }))}
                  placeholder="Food, tech, legal, care..."
                />
              </div>
            </div>
            <div>
              <Label className="text-gray-300">Description</Label>
              <Textarea
                className="mt-1 border-slate-700 bg-slate-950 text-white"
                value={businessForm.description}
                onChange={(event) => setBusinessForm((form) => ({ ...form, description: event.target.value }))}
              />
            </div>
            <div>
              <Label className="text-gray-300">Image URL</Label>
              <Input
                className="mt-1 border-slate-700 bg-slate-950 text-white"
                value={businessForm.imageUrl}
                onChange={(event) => setBusinessForm((form) => ({ ...form, imageUrl: event.target.value }))}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="text-gray-300">Address</Label>
                <DirectoryPlaceInput
                  value={businessForm.address}
                  selectedLabel={businessForm.formattedAddress}
                  onSearchChange={handleLocationSearchChange}
                  onPlaceSelect={handlePlaceSelect}
                />
              </div>
              {businessForm.formattedAddress && (
                <div className="md:col-span-2 rounded-md border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-300">
                  <p className="font-medium text-white">{businessForm.formattedAddress}</p>
                  {[businessForm.city, businessForm.state, businessForm.zipCode].filter(Boolean).length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {[businessForm.city, businessForm.state, businessForm.zipCode].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                className="border-slate-700 bg-slate-950 text-white"
                placeholder="Phone"
                value={businessForm.phone}
                onChange={(event) => setBusinessForm((form) => ({ ...form, phone: event.target.value }))}
              />
              <Input
                className="border-slate-700 bg-slate-950 text-white"
                placeholder="Email"
                value={businessForm.email}
                onChange={(event) => setBusinessForm((form) => ({ ...form, email: event.target.value }))}
              />
            </div>
            <Input
              className="border-slate-700 bg-slate-950 text-white"
              placeholder="Website URL"
              value={businessForm.website}
              onChange={(event) => setBusinessForm((form) => ({ ...form, website: event.target.value }))}
            />
            <Input
              className="border-slate-700 bg-slate-950 text-white"
              placeholder="Tags separated by commas"
              value={businessForm.tags}
              onChange={(event) => setBusinessForm((form) => ({ ...form, tags: event.target.value }))}
            />
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <Switch
                  checked={businessForm.isFeatured}
                  onCheckedChange={(checked) => setBusinessForm((form) => ({ ...form, isFeatured: checked }))}
                />
                Featured
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <Switch
                  checked={businessForm.isActive}
                  onCheckedChange={(checked) => setBusinessForm((form) => ({ ...form, isActive: checked }))}
                />
                Active
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleBusinessSubmit}
                disabled={isSavingBusiness || !businessForm.name.trim() || !hasSelectedLocation(businessForm)}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                {businessForm.id ? "Save" : "Add"}
              </Button>
              {businessForm.id && (
                <Button variant="outline" onClick={() => setBusinessForm(emptyBusiness)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {directoryQuery.data?.businesses.length ? (
              directoryQuery.data.businesses.map((business) => (
                <div
                  key={business.id}
                  className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-[1fr_auto]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-white">{business.name}</p>
                      {business.category && <Badge variant="secondary">{business.category}</Badge>}
                      {business.isFeatured && <Badge>Featured</Badge>}
                      {!business.isActive && <Badge variant="outline">Hidden</Badge>}
                    </div>
                    {business.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-400">{business.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                      {[business.city, business.state].filter(Boolean).length > 0 && (
                        <span>{[business.city, business.state].filter(Boolean).join(", ")}</span>
                      )}
                      {business.website && (
                        <a
                          href={business.website}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:text-gray-300"
                        >
                          Website <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setBusinessForm(formFromBusiness(business))}>
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteBusiness.mutate({ coopId, id: business.id })}
                      disabled={deleteBusiness.isPending}
                      className="text-red-300 hover:text-red-200"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center">
                <Building2 className="mx-auto h-10 w-10 text-gray-500" />
                <p className="mt-3 text-sm text-gray-400">No directory businesses yet.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
