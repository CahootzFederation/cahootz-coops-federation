import type { BlogPost } from "./blog";

// Posts written here instead of Notion. The build re-syncs blog.generated.ts
// from Notion and overwrites it, so hand-written posts live in this file.
// Block text is rendered as HTML, the same as synced Notion text.
export const manualBlogPosts: BlogPost[] = [
  {
    slug: "your-next-customers-could-be-your-community",
    title:
      "Your Next Customers Could Be Your Community: The Case for Demand Co-ops",
    description:
      "People already pay for the same tools and services. A demand co-op brings those needs together so providers have a reason to build, members pay less, and the difference goes into a treasury they govern.",
    excerpt:
      "A demand co-op organizes its members’ purchasing power around shared needs. Here’s a practical place to start: the software we already use every day.",
    publishedAt: "2026-10-30",
    updatedAt: "2026-10-30",
    author: "Deon Robinson",
    category: "Business",
    readingTime: "6 min read",
    image: "https://app.notion.com/images/page-cover/webb2.jpg",
    imageAlt: "A deep-space image of glowing gas and stars.",
    featured: false,
    tags: [],
    blocks: [
      {
        type: "paragraph",
        text: "A demand co-op organizes its members’ purchasing power around shared needs. People already spend money on things they need. We go to the store, Walmart, or Amazon to buy everyday items. The question is whether coordinating some of those purchases would let us approach providers together, negotiate terms, and help shape what gets offered—or become our own providers.",
      },
      {
        type: "paragraph",
        text: 'In “<a href="/blog/what-is-a-demand-coop">What is a Demand Coop</a>,” we explored how organized spending could help communities build businesses and shared assets. Here, we want to focus on a practical place to begin: products and services that we already use daily on our computers.',
      },
      {
        type: "paragraph",
        text: "What could we get as a group that would be harder, more expensive, or less convenient to obtain individually—but that we could now build for a fraction of the cost?",
      },
      { type: "heading", level: 2, text: "Our shared needs" },
      {
        type: "paragraph",
        text: "Think about what you pay for: food, water, a place to stay, GitHub, Google Workspace, Figma, Zoom, 1Password, bookkeeping software, and tools for running a business or learning a skill.",
      },
      {
        type: "paragraph",
        text: "Other people in your community may be paying for the same things or going without them because the available options cost too much or don’t quite fit.",
      },
      {
        type: "paragraph",
        text: "We usually approach these decisions individually. A small business owner needs a booking system. A freelancer needs a way to send invoices. A community organization needs somewhere to keep records and communicate. Each person searches for a familiar provider, compares plans, and adds another subscription.",
      },
      {
        type: "paragraph",
        text: "Those purchases represent demand that already exists. They also represent money we could potentially use to pay someone in our community to meet a shared need.",
      },
      {
        type: "paragraph",
        text: "A co-op could bring those needs together into a clear proposal: Here are the people who need this, what they need it to do, and what they are prepared to pay.",
      },
      {
        type: "paragraph",
        text: "That gives someone a reason to build and a group of customers to build for.",
      },
      { type: "heading", level: 2, text: "Start with what we actually use" },
      {
        type: "paragraph",
        text: "The familiar products help us name the need. The next step is understanding which parts of them we actually depend on.",
      },
      {
        type: "paragraph",
        text: "A group of small businesses might need appointment scheduling, reminders, and a simple customer list. Freelancers might need invoicing and expense tracking. A community might need shared documents, event registration, and a member directory.",
      },
      {
        type: "paragraph",
        text: "If you’re an engineer, there are plenty of shared products that would be easy to build now: a source-code manager, a cloud provider, an email client, and direct messaging. Where do we have clear demand?",
      },
      {
        type: "paragraph",
        text: "There may also be existing tools or open-source projects that a provider could adapt, host, and support. The opportunity includes doing the work that makes software useful: setup, migration, training, maintenance, and helping people when something breaks.",
      },
      {
        type: "paragraph",
        text: "Some products require substantial security, reliability, or regulatory expertise. Password management, for example, carries responsibilities that go well beyond creating a working interface. Choosing the first project means understanding both the shared need and what it will take to serve it responsibly.",
      },
      {
        type: "heading",
        level: 2,
        text: "AI changes what we can build. Coordination changes who we build it for.",
      },
      {
        type: "paragraph",
        text: "AI can reduce the time involved in parts of software development, including writing code, producing documentation, and handling routine tasks. A small team may be able to create a useful first version with fewer resources than it would have needed before.",
      },
      {
        type: "paragraph",
        text: "But a cheaper first version does not automatically become a sustainable business.",
      },
      {
        type: "paragraph",
        text: "Someone still has to find customers, understand their needs, earn their trust, and support the product. A person can spend months building something and discover that very few people will pay for it.",
      },
      { type: "paragraph", text: "That is where organized demand matters." },
      {
        type: "paragraph",
        text: "A co-op could identify a shared need before the work begins. Members could agree on the essential features, review a proposal, and make commitments to buy under clear terms. A provider could then build with a better understanding of who will use the product and how the work will be paid for.",
      },
      {
        type: "paragraph",
        text: "AI helps with the work of making the tool. Coordination helps create the conditions for that work to support a livelihood.",
      },
      {
        type: "paragraph",
        text: "Then we can agree to share ownership and decide how to use the funds—for example, to create more stable working conditions, provide opportunities to train for different industries, and prepare for an uncertain future.",
      },
      { type: "heading", level: 2, text: "What each side gets" },
      {
        type: "paragraph",
        text: "Cahootz organizes buyers around shared needs so businesses can offer better group pricing. That creates room for members to pay less while the difference between the negotiated provider price and the member price goes into a community treasury.",
      },
      {
        type: "paragraph",
        text: "Businesses keep ownership of their products. They gain customers and the opportunity for recurring revenue. Members get useful products at better prices while helping build a fund they govern together.",
      },
      {
        type: "paragraph",
        text: "The immediate benefit is a better deal for buyers and more business for providers. Over time, the treasury can fund priorities members choose: housing, training, community businesses, and projects that create stable jobs. Everyday purchases become a way to build greater security and bargaining power together.",
      },
      { type: "heading", level: 2, text: "Our offer and our ask" },
      {
        type: "paragraph",
        text: "Joining Cahootz is free. We’re looking for people with businesses to share and people who want better options for things they already buy.",
      },
      {
        type: "paragraph",
        text: '<strong>Have a business, product, or service?</strong> <a href="/#business-form">Tell us about it.</a> What do you offer? Who is it for? What price could you offer a group, and how many customers would make that work for you?',
      },
      {
        type: "paragraph",
        text: "We want to help you find customers and put together a deal that pays you fairly, saves buyers money, and contributes to the community treasury.",
      },
      {
        type: "paragraph",
        text: '<strong>Looking for something?</strong> <a href="/#waitlist">Join the waitlist.</a> Maybe there’s a subscription that costs too much, a tool that never quite does what you need, or a service you’ve been putting off paying for. Those are the kinds of needs we want to bring together.',
      },
      {
        type: "paragraph",
        text: 'We’ll start by making the first offers. We want to build community-owned versions of the software we use: a source-code manager and a cloud provider (or a wrapper around one). <a href="/#waitlist">Sign up now</a> for a group deal on these tools and contribute to the effort.',
      },
      {
        type: "quote",
        text: "Your next customers could be your community. Your next purchase could help build its future.",
      },
    ],
  },
];
