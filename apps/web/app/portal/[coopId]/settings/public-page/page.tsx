"use client";

import { useParams } from "next/navigation";
import { useWeb3Auth } from "@/hooks/use-web3-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Eye, Save, Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "@/lib/trpc/client";
import Link from "next/link";

interface Feature {
  title: string;
  description: string;
  iconName?: string;
}

interface FAQ {
  question: string;
  answer: string;
}

interface ContactLink {
  label: string;
  url: string;
  type?: 'email' | 'phone' | 'social';
}

export default function PublicPageSettingsPage() {
  const params = useParams();
  const coopId = params.coopId as string;
  const { isAdmin } = useWeb3Auth();

  const [saved, setSaved] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#f59e0b");
  const [accentColor, setAccentColor] = useState("#ea580c");
  const [backgroundColor, setBackgroundColor] = useState("#1a1a1a");
  const [aboutTitle, setAboutTitle] = useState("About Us");
  const [aboutBody, setAboutBody] = useState("");
  const [missionBody, setMissionBody] = useState("");
  const [eligibilityTitle, setEligibilityTitle] = useState("Who Can Join");
  const [eligibilityBody, setEligibilityBody] = useState("");
  const [features, setFeatures] = useState<Feature[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [contactEmail, setContactEmail] = useState("");
  const [contactLinks, setContactLinks] = useState<ContactLink[]>([]);
  const [newsletterUrl, setNewsletterUrl] = useState("");
  const [primaryCtaLabel, setPrimaryCtaLabel] = useState("Join Now");
  const [primaryCtaUrl, setPrimaryCtaUrl] = useState("");
  const [mobileAppUrl, setMobileAppUrl] = useState("https://mobile.cahootzcoops.com");
  const [previewMode, setPreviewMode] = useState<'live' | 'curated' | 'hybrid'>('hybrid');
  const [showStatsBar, setShowStatsBar] = useState(true);
  const [isPublished, setIsPublished] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  // Load existing public info
  const { data: publicInfo, isLoading, refetch } = api.publicCoopInfo.getForEdit.useQuery(
    { coopId },
    { enabled: isAdmin }
  );

  // Bootstrap mutation
  const bootstrap = api.publicCoopInfo.bootstrapFromConfig.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  // Create blank mutation
  const createBlank = api.publicCoopInfo.createBlank.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  // Update mutation
  const updatePublicInfo = api.publicCoopInfo.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      refetch();
    },
  });

  // Load data into form when available
  useEffect(() => {
    if (publicInfo) {
      setName(publicInfo.name || "");
      setTagline(publicInfo.tagline || "");
      setHeroTitle(publicInfo.heroTitle || "");
      setHeroSubtitle(publicInfo.heroSubtitle || "");
      setHeroImageUrl(publicInfo.heroImageUrl || "");
      setLogoUrl(publicInfo.logoUrl || "");
      setCoverImageUrl(publicInfo.coverImageUrl || "");
      setPrimaryColor(publicInfo.primaryColor);
      setAccentColor(publicInfo.accentColor);
      setBackgroundColor(publicInfo.backgroundColor);
      setAboutTitle(publicInfo.aboutTitle || "About Us");
      setAboutBody(publicInfo.aboutBody || "");
      setMissionBody(publicInfo.missionBody || "");
      setEligibilityTitle(publicInfo.eligibilityTitle || "Who Can Join");
      setEligibilityBody(publicInfo.eligibilityBody || "");
      setFeatures((publicInfo.features as Feature[]) || []);
      setFaqs((publicInfo.faqs as FAQ[]) || []);
      setContactEmail(publicInfo.contactEmail || "");
      setContactLinks((publicInfo.contactLinks as ContactLink[]) || []);
      setNewsletterUrl(publicInfo.newsletterUrl || "");
      setPrimaryCtaLabel(publicInfo.primaryCtaLabel || "Join Now");
      setPrimaryCtaUrl(publicInfo.primaryCtaUrl || "");
      setMobileAppUrl(publicInfo.mobileAppUrl || "https://mobile.cahootzcoops.com");
      setPreviewMode(publicInfo.previewMode as 'live' | 'curated' | 'hybrid');
      setShowStatsBar(publicInfo.showStatsBar ?? true);
      setIsPublished(publicInfo.isPublished);
      setSeoTitle(publicInfo.seoTitle || "");
      setSeoDescription(publicInfo.seoDescription || "");
    }
  }, [publicInfo]);

  const handleSave = () => {
    updatePublicInfo.mutate({
      coopId,
      data: {
        name,
        tagline,
        heroTitle,
        heroSubtitle,
        heroImageUrl: heroImageUrl || null,
        logoUrl: logoUrl || null,
        coverImageUrl: coverImageUrl || null,
        primaryColor,
        accentColor,
        backgroundColor,
        aboutTitle,
        aboutBody: aboutBody || undefined,
        missionBody: missionBody || undefined,
        eligibilityTitle,
        eligibilityBody: eligibilityBody || undefined,
        features: features.length > 0 ? features : undefined,
        faqs: faqs.length > 0 ? faqs : undefined,
        contactEmail: contactEmail || null,
        contactLinks: contactLinks.length > 0 ? contactLinks : undefined,
        newsletterUrl: newsletterUrl || null,
        primaryCtaLabel,
        primaryCtaUrl: primaryCtaUrl || null,
        mobileAppUrl: mobileAppUrl || null,
        previewMode,
        showStatsBar,
        isPublished,
        seoTitle: seoTitle || undefined,
        seoDescription: seoDescription || undefined,
      },
    });
  };

  const addFeature = () => {
    setFeatures([...features, { title: "", description: "" }]);
  };

  const removeFeature = (index: number) => {
    setFeatures(features.filter((_, i) => i !== index));
  };

  const updateFeature = (index: number, field: keyof Feature, value: string) => {
    const updated = [...features];
    updated[index] = { ...updated[index], [field]: value };
    setFeatures(updated);
  };

  const addFaq = () => {
    setFaqs([...faqs, { question: "", answer: "" }]);
  };

  const removeFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const updateFaq = (index: number, field: keyof FAQ, value: string) => {
    const updated = [...faqs];
    updated[index] = { ...updated[index], [field]: value };
    setFaqs(updated);
  };

  const addContactLink = () => {
    setContactLinks([...contactLinks, { label: "", url: "" }]);
  };

  const removeContactLink = (index: number) => {
    setContactLinks(contactLinks.filter((_, i) => i !== index));
  };

  const updateContactLink = (index: number, field: keyof ContactLink, value: string) => {
    const updated = [...contactLinks];
    updated[index] = { ...updated[index], [field]: value };
    setContactLinks(updated);
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You must be an admin to manage public page settings.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!publicInfo) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Public Page Not Set Up</h1>
          <p className="text-gray-500 mt-1">
            Create your coop&apos;s public landing page to get started
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bootstrap from CoopConfig</CardTitle>
              <CardDescription>
                Copy existing settings from your CoopConfig to pre-fill the public page with your coop&apos;s name, tagline, mission, and branding.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => bootstrap.mutate({ coopId })}
                disabled={bootstrap.isPending || createBlank.isPending}
                className="w-full"
              >
                {bootstrap.isPending ? "Bootstrapping..." : "Bootstrap from CoopConfig"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create Blank Page</CardTitle>
              <CardDescription>
                Start with a blank public page template with default branding. You can customize everything in the editor.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => createBlank.mutate({ coopId })}
                disabled={bootstrap.isPending || createBlank.isPending}
                variant="outline"
                className="w-full"
              >
                {createBlank.isPending ? "Creating..." : "Create Blank Page"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <p className="text-sm text-blue-900">
              <strong>Note:</strong> Your public page will start unpublished. You can edit and preview it before making it live.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Public Page Settings</h1>
          <p className="text-gray-500 mt-1">
            Manage your coop&apos;s public-facing landing page
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/c/${coopId}`}
            target="_blank"
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Eye size={18} />
            Preview
          </Link>
          <Button
            onClick={handleSave}
            disabled={updatePublicInfo.isPending}
            className="inline-flex items-center gap-2"
          >
            <Save size={18} />
            {saved ? "Saved!" : updatePublicInfo.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Publishing Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe size={20} />
            Publishing Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="w-5 h-5"
              />
              <span className="font-semibold">Published</span>
            </label>
            {isPublished ? (
              <span className="text-green-600 text-sm">✓ Page is live</span>
            ) : (
              <span className="text-yellow-600 text-sm">⚠ Page is hidden</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Hero Section */}
      <Card>
        <CardHeader>
          <CardTitle>Hero Section</CardTitle>
          <CardDescription>Main headline and call-to-action</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Coop Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cahootz Co-op"
            />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Building community wealth together"
            />
          </div>
          <div>
            <Label>Hero Title (optional override)</Label>
            <Input
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="Leave empty to use name"
            />
          </div>
          <div>
            <Label>Hero Subtitle</Label>
            <Textarea
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="A brief description that appears below the title"
              rows={3}
            />
          </div>
          <div>
            <Label>Logo URL</Label>
            <Input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </div>
          <div>
            <Label>Hero Image URL</Label>
            <Input
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="https://example.com/hero.jpg"
            />
          </div>
          <div>
            <Label>Cover Image URL (background)</Label>
            <Input
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://example.com/cover.jpg"
            />
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle>Branding & Colors</CardTitle>
          <CardDescription>Customize your page colors</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Primary Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#f59e0b"
                />
              </div>
            </div>
            <div>
              <Label>Accent Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#ea580c"
                />
              </div>
            </div>
            <div>
              <Label>Background Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  placeholder="#1a1a1a"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* About Section */}
      <Card>
        <CardHeader>
          <CardTitle>About Section</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Section Title</Label>
            <Input
              value={aboutTitle}
              onChange={(e) => setAboutTitle(e.target.value)}
              placeholder="About Us"
            />
          </div>
          <div>
            <Label>About Body</Label>
            <Textarea
              value={aboutBody}
              onChange={(e) => setAboutBody(e.target.value)}
              placeholder="Tell your story..."
              rows={6}
            />
          </div>
        </CardContent>
      </Card>

      {/* Mission Section */}
      <Card>
        <CardHeader>
          <CardTitle>Mission Section</CardTitle>
        </CardHeader>
        <CardContent>
          <Label>Mission Statement</Label>
          <Textarea
            value={missionBody}
            onChange={(e) => setMissionBody(e.target.value)}
            placeholder="Our mission is to..."
            rows={6}
          />
        </CardContent>
      </Card>

      {/* Eligibility Section */}
      <Card>
        <CardHeader>
          <CardTitle>Eligibility Section</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Section Title</Label>
            <Input
              value={eligibilityTitle}
              onChange={(e) => setEligibilityTitle(e.target.value)}
              placeholder="Who Can Join"
            />
          </div>
          <div>
            <Label>Eligibility Requirements</Label>
            <Textarea
              value={eligibilityBody}
              onChange={(e) => setEligibilityBody(e.target.value)}
              placeholder="Describe who can join your coop..."
              rows={6}
            />
          </div>
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Features / Benefits</CardTitle>
          <CardDescription>Highlight why people should join</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {features.map((feature, index) => (
            <div key={index} className="p-4 border rounded-lg space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold text-gray-500">Feature {index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFeature(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <Input
                value={feature.title}
                onChange={(e) => updateFeature(index, 'title', e.target.value)}
                placeholder="Feature title"
              />
              <Textarea
                value={feature.description}
                onChange={(e) => updateFeature(index, 'description', e.target.value)}
                placeholder="Feature description"
                rows={2}
              />
            </div>
          ))}
          <Button onClick={addFeature} variant="outline" className="w-full">
            <Plus size={16} className="mr-2" />
            Add Feature
          </Button>
        </CardContent>
      </Card>

      {/* FAQs */}
      <Card>
        <CardHeader>
          <CardTitle>FAQs</CardTitle>
          <CardDescription>Answer common questions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="p-4 border rounded-lg space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-sm font-semibold text-gray-500">FAQ {index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFaq(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <Input
                value={faq.question}
                onChange={(e) => updateFaq(index, 'question', e.target.value)}
                placeholder="Question"
              />
              <Textarea
                value={faq.answer}
                onChange={(e) => updateFaq(index, 'answer', e.target.value)}
                placeholder="Answer"
                rows={3}
              />
            </div>
          ))}
          <Button onClick={addFaq} variant="outline" className="w-full">
            <Plus size={16} className="mr-2" />
            Add FAQ
          </Button>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Contact Email</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="hello@example.com"
            />
          </div>
          <div>
            <Label>Newsletter URL</Label>
            <Input
              value={newsletterUrl}
              onChange={(e) => setNewsletterUrl(e.target.value)}
              placeholder="https://example.com/newsletter"
            />
          </div>
          <div>
            <Label>Contact Links</Label>
            {contactLinks.map((link, index) => (
              <div key={index} className="flex gap-2 mt-2">
                <Input
                  value={link.label}
                  onChange={(e) => updateContactLink(index, 'label', e.target.value)}
                  placeholder="Label"
                  className="flex-1"
                />
                <Input
                  value={link.url}
                  onChange={(e) => updateContactLink(index, 'url', e.target.value)}
                  placeholder="URL"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeContactLink(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
            <Button onClick={addContactLink} variant="outline" className="w-full mt-2">
              <Plus size={16} className="mr-2" />
              Add Link
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Call-to-Action */}
      <Card>
        <CardHeader>
          <CardTitle>Call-to-Action</CardTitle>
          <CardDescription>Configure your primary signup button</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>CTA Button Label</Label>
            <Input
              value={primaryCtaLabel}
              onChange={(e) => setPrimaryCtaLabel(e.target.value)}
              placeholder="Join Now"
            />
          </div>
          <div>
            <Label>Mobile App URL</Label>
            <Input
              value={mobileAppUrl}
              onChange={(e) => setMobileAppUrl(e.target.value)}
              placeholder="https://mobile.cahootzcoops.com"
            />
          </div>
          <div>
            <Label>Custom CTA URL (optional)</Label>
            <Input
              value={primaryCtaUrl}
              onChange={(e) => setPrimaryCtaUrl(e.target.value)}
              placeholder="Leave empty to use mobile app URL"
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Preview Section</CardTitle>
          <CardDescription>Show stores, proposals, and activity</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Preview Mode</Label>
            <select
              value={previewMode}
              onChange={(e) => setPreviewMode(e.target.value as 'live' | 'curated' | 'hybrid')}
              className="w-full p-2 border rounded-lg"
            >
              <option value="live">Live - Show real data only</option>
              <option value="curated">Curated - Show custom content only</option>
              <option value="hybrid">Hybrid - Live data with curated overrides</option>
            </select>
          </div>
          <p className="text-sm text-gray-500">
            Live mode shows recent stores and proposals automatically. Curated mode requires manual content. Hybrid uses live data but allows you to override specific items.
          </p>
        </CardContent>
      </Card>

      {/* Display Options */}
      <Card>
        <CardHeader>
          <CardTitle>Display Options</CardTitle>
          <CardDescription>Control what appears on your public page</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Show Stats Bar</Label>
              <p className="text-sm text-muted-foreground">
                Display member count, stores, products, and treasury stats
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showStatsBar}
                onChange={(e) => setShowStatsBar(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
            </label>
          </div>
          <p className="text-sm text-gray-500">
            Hide the stats bar when your coop is just starting out to avoid showing empty numbers.
          </p>
        </CardContent>
      </Card>

      {/* SEO */}
      <Card>
        <CardHeader>
          <CardTitle>SEO Settings</CardTitle>
          <CardDescription>Optimize for search engines</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>SEO Title</Label>
            <Input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="Leave empty to use coop name"
            />
          </div>
          <div>
            <Label>SEO Description</Label>
            <Textarea
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder="Leave empty to use tagline"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button at Bottom */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={updatePublicInfo.isPending}
          size="lg"
          className="inline-flex items-center gap-2"
        >
          <Save size={18} />
          {saved ? "Saved!" : updatePublicInfo.isPending ? "Saving..." : "Save All Changes"}
        </Button>
      </div>
    </div>
  );
}
