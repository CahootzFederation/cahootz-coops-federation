/**
 * Seed script to add display information to existing CoopConfig records
 *
 * Run with: pnpm tsx scripts/seed-coop-display-info.ts
 */

import * as PrismaClientModule from "@prisma/client";

const PrismaClient =
  (PrismaClientModule as any).PrismaClient ?? (PrismaClientModule as any).default.PrismaClient;

const prisma = new PrismaClient();

async function seedCoopDisplayInfo() {
  console.log("Seeding coop display information...");

  // Soulaan Black Wealth Coop
  const soulaanConfig = await prisma.coopConfig.findFirst({
    where: { coopId: "soulaan", isActive: true },
  });

  if (soulaanConfig) {
    await prisma.coopConfig.update({
      where: { id: soulaanConfig.id },
      data: {
        name: "Soulaan Black Wealth Coop",
        slug: "soulaan-black-wealth-coop",
        tagline: "Building Black Economic Sovereignty",
        description:
          "A cooperative for Black Americans to achieve economic independence through collective ownership, community investment, and democratic governance. Build wealth, support Black businesses, and create opportunities together.",
        displayMission:
          "To empower Black Americans by building economic independence and sovereignty through cooperative ownership, local investment, and democratic governance.",
        displayFeatures: [
          {
            title: "Shared Wealth Fund",
            description:
              "A community fund that can back housing, training, businesses, and other projects that build long-term Black wealth.",
          },
          {
            title: "Real Voice in Decisions",
            description:
              "Members help shape priorities, support proposals, and have a say in how resources are used to strengthen the community.",
          },
          {
            title: "A Stronger Black Economy",
            description:
              "More of our money stays in our communities through Black-owned businesses, jobs, shared ownership, and practical economic support.",
          },
        ],
        eligibility:
          "Open to Black Americans, Afro-Caribbean, African immigrants, and allies (non-voting)",
        bgColor: "bg-red-700",
        accentColor: "bg-gold-600",
        displayOrder: 1,
        applicationQuestions: [
          {
            id: "identity",
            type: "radio",
            label: "Are you applying as:",
            required: true,
            options: [
              { value: "black-american", label: "Black American (African American)" },
              { value: "afro-caribbean", label: "Afro-Caribbean" },
              { value: "african-immigrant", label: "African immigrant" },
              { value: "ally", label: "Ally (non-voting)" },
            ],
          },
          {
            id: "agreeToMission",
            type: "radio",
            label: "Do you agree that the mission of the Co-op is to circulate and grow Black wealth through collective buying power?",
            required: true,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "spendingCategories",
            type: "multiselect",
            label: "What categories do you spend the most on monthly? (Select all that apply)",
            required: true,
            options: [
              { value: "Rent/Housing", label: "Rent/Housing" },
              { value: "Groceries", label: "Groceries" },
              { value: "Utilities/Phone/Internet", label: "Utilities/Phone/Internet" },
              { value: "Transportation (gas, rideshare, car service)", label: "Transportation (gas, rideshare, car service)" },
              { value: "Healthcare/Insurance", label: "Healthcare/Insurance" },
              { value: "Retail/Shopping", label: "Retail/Shopping" },
            ],
          },
          {
            id: "monthlyCommitment",
            type: "radio",
            label: "Roughly how much of your monthly spending could you commit to route through the Co-op (in UC)?",
            required: true,
            options: [
              { value: "less-250", label: "Less than $250" },
              { value: "250-500", label: "$250–$500" },
              { value: "500-1000", label: "$500–$1,000" },
              { value: "over-1000", label: "Over $1,000" },
            ],
          },

          {
            id: "useUC",
            type: "radio",
            label: "Use UC (the co-op's stablecoin) for purchases and rent?",
            required: true,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "acceptFees",
            type: "radio",
            label: "Accept small fees that go into the Co-op's wealth fund?",
            required: true,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "voteOnInvestments",
            type: "radio",
            label: "Vote on how the Co-op invests surplus funds (if eligible)?",
            required: true,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "coopExperience",
            type: "radio",
            label: "Have you ever participated in a co-op, credit union, or sou-sou (rotating savings club)?",
            required: true,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "transparentTransactions",
            type: "radio",
            label: "Are you willing to make your Co-op transactions visible on-chain (pseudonymous, but transparent to the community) to support trust?",
            required: true,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
          {
            id: "motivation",
            type: "textarea",
            label: "Why do you want to join the Cahootz Co-op? (Optional)",
            placeholder: "Share your motivation for joining...",
            required: false,
            validation: { maxLength: 500 },
          },
          {
            id: "desiredService",
            type: "textarea",
            label: "What's one product or service you'd most like to see offered through the Co-op first? (Optional)",
            placeholder: "What would you like to see offered first...",
            required: false,
            validation: { maxLength: 500 },
          },
        ],
      },
    });
    console.log("  ✓ Updated Soulaan coop display info");
  } else {
    console.log("  ⚠ Soulaan coop config not found");
  }

  // SF Nightlife Coop
  let sfNightlifeConfig = await prisma.coopConfig.findFirst({
    where: { coopId: "sf-nightlife", isActive: true },
  });

  // Create if doesn't exist
  if (!sfNightlifeConfig) {
    sfNightlifeConfig = await prisma.coopConfig.create({
      data: {
        coopId: "sf-nightlife",
        version: 1,
        isActive: true,
        charterText: "The SF Nightlife Coop charter - empowering nightlife workers through collective support.",
        missionGoals: [
          { key: "housing", label: "Provide housing support", priorityWeight: 0.4 },
          { key: "employment", label: "Create employment opportunities", priorityWeight: 0.3 },
          { key: "ownership", label: "Enable venue ownership", priorityWeight: 0.3 },
        ],
        structuralWeights: { feasibility: 0.4, risk: 0.3, accountability: 0.3 },
        scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
        proposalCategories: [
          { key: "housing", label: "Housing", isActive: true },
          { key: "employment", label: "Employment", isActive: true },
          { key: "venue", label: "Venue Ownership", isActive: true },
        ],
        sectorExclusions: [],
        createdBy: "system",
      },
    });
  }

  if (sfNightlifeConfig) {
    await prisma.coopConfig.update({
      where: { id: sfNightlifeConfig.id },
      data: {
        name: "The SF Nightlife Coop",
        slug: "sf-nightlife-coop",
        tagline: "Empowering SF Nightlife Workers to Thrive",
        description:
          "A cooperative dedicated to helping San Francisco nightlife industry workers find housing, secure stable employment, purchase venues, and achieve financial stability through collective support and resources.",
        displayMission:
          "To empower San Francisco nightlife industry workers by providing access to affordable housing, stable employment opportunities, venue ownership, and financial advancement through cooperative ownership and mutual support.",
        displayFeatures: [
          {
            title: "Housing Support",
            description:
              "Access co-op backed housing assistance, roommate matching, and rental support specifically designed for nightlife workers with non-traditional schedules.",
          },
          {
            title: "Employment Network",
            description:
              "Connect with stable employment opportunities, skill development programs, and career advancement resources within and beyond the nightlife industry.",
          },
          {
            title: "Venue Ownership",
            description:
              "Pool resources with fellow members to collectively purchase and operate nightlife venues, creating ownership opportunities and long-term wealth building.",
          },
        ],
        eligibility:
          "Open to SF nightlife industry workers including DJs, bartenders, servers, security, promoters, and venue staff",
        bgColor: "bg-purple-700",
        accentColor: "bg-purple-600",
        displayOrder: 2,
        applicationQuestions: [
          {
            id: "nightlife_role",
            type: "select",
            label: "What's your role in the nightlife industry?",
            required: true,
            options: [
              { value: "dj", label: "DJ/Musician" },
              { value: "bartender", label: "Bartender" },
              { value: "server", label: "Server/Wait Staff" },
              { value: "security", label: "Security" },
              { value: "promoter", label: "Promoter/Event Organizer" },
              { value: "venue-staff", label: "Venue Staff" },
              { value: "artist", label: "Artist/Creative" },
              { value: "other", label: "Other" },
            ],
          },
          {
            id: "years_experience",
            type: "select",
            label: "How long have you worked in SF nightlife?",
            required: true,
            options: [
              { value: "less-1", label: "Less than 1 year" },
              { value: "1-3", label: "1-3 years" },
              { value: "3-5", label: "3-5 years" },
              { value: "5-10", label: "5-10 years" },
              { value: "over-10", label: "Over 10 years" },
            ],
          },
          {
            id: "housing_need",
            type: "radio",
            label: "Do you need housing assistance?",
            required: true,
            options: [
              { value: "yes", label: "Yes, urgently" },
              { value: "soon", label: "Yes, within 6 months" },
              { value: "no", label: "No, I'm stable" },
            ],
          },
          {
            id: "employment_stability",
            type: "radio",
            label: "How stable is your current income?",
            required: true,
            options: [
              { value: "very-stable", label: "Very stable" },
              { value: "somewhat-stable", label: "Somewhat stable" },
              { value: "unstable", label: "Unstable/Inconsistent" },
            ],
          },
          {
            id: "interests",
            type: "multiselect",
            label: "What co-op benefits interest you most?",
            description: "Select all that apply",
            required: true,
            options: [
              { value: "housing", label: "Housing support" },
              { value: "employment", label: "Employment opportunities" },
              { value: "venue-ownership", label: "Venue ownership" },
              { value: "financial-stability", label: "Financial planning/stability" },
              { value: "networking", label: "Professional networking" },
              { value: "skill-development", label: "Skill development" },
            ],
          },
          {
            id: "motivation",
            type: "textarea",
            label: "Why do you want to join The SF Nightlife Coop? (Optional)",
            placeholder: "Share your story and what you hope to gain from membership...",
            required: false,
            validation: { maxLength: 500 },
          },
        ],
      },
    });
    console.log("  ✓ Updated SF Nightlife coop display info");
  } else {
    console.log("  ⚠ SF Nightlife coop config not found");
  }

  // Cahootz Coop
  let cahootzConfig = await prisma.coopConfig.findFirst({
    where: { coopId: "cahootz", isActive: true },
  });

  // Create if doesn't exist
  if (!cahootzConfig) {
    cahootzConfig = await prisma.coopConfig.create({
      data: {
        coopId: "cahootz",
        version: 1,
        isActive: true,
        charterText: "The Unity Coop (Cahootz) charter - building cooperative technology infrastructure.",
        missionGoals: [
          { key: "platform", label: "Build platform technology", priorityWeight: 0.4 },
          { key: "infrastructure", label: "Maintain infrastructure", priorityWeight: 0.3 },
          { key: "tools", label: "Create coop tools", priorityWeight: 0.3 },
        ],
        structuralWeights: { feasibility: 0.4, risk: 0.3, accountability: 0.3 },
        scoreMix: { missionWeight: 0.6, structuralWeight: 0.4 },
        proposalCategories: [
          { key: "development", label: "Development", isActive: true },
          { key: "infrastructure", label: "Infrastructure", isActive: true },
          { key: "tools", label: "Tools & Systems", isActive: true },
        ],
        sectorExclusions: [],
        createdBy: "system",
      },
    });
  }

  if (cahootzConfig) {
    await prisma.coopConfig.update({
      where: { id: cahootzConfig.id },
      data: {
        name: "Unity Coop",
        slug: "unity-coop",
        tagline: "Building the Infrastructure for Cooperative Economies",
        description:
          "The internal builder cooperative behind the Cahootz ecosystem. Cahootz Coop is made up of the people who build, operate, and maintain the technology and infrastructure that powers Cahootz coops.",
        displayMission:
          "To create and maintain the technology, tools, and systems that allow cooperative economies to function and grow.",
        displayFeatures: [
          {
            title: "Platform Development",
            description:
              "Build and maintain the Cahootz platform, developing software and internal tools that power the entire coop network.",
          },
          {
            title: "Technical Infrastructure",
            description:
              "Support operations and technical infrastructure for the coop network, ensuring reliability and scalability.",
          },
          {
            title: "Shared Systems",
            description:
              "Create shared systems that help coops launch and scale, giving builders and contributors ownership in the ecosystem they create.",
          },
        ],
        eligibility:
          "Open to software engineers, designers, product builders, operators, organizers, and technical contributors building the Cahootz ecosystem",
        bgColor: "bg-blue-700",
        accentColor: "bg-blue-600",
        displayOrder: 3,
        applicationQuestions: [
          {
            id: "technical_role",
            type: "select",
            label: "What's your primary role?",
            required: true,
            options: [
              { value: "engineer", label: "Software Engineer" },
              { value: "designer", label: "Designer" },
              { value: "product", label: "Product Manager" },
              { value: "operator", label: "Operator/Organizer" },
              { value: "other-tech", label: "Other Technical Role" },
            ],
          },
          {
            id: "experience_level",
            type: "select",
            label: "Years of professional experience?",
            required: true,
            options: [
              { value: "0-2", label: "0-2 years" },
              { value: "3-5", label: "3-5 years" },
              { value: "6-10", label: "6-10 years" },
              { value: "over-10", label: "Over 10 years" },
            ],
          },
          {
            id: "skills",
            type: "multiselect",
            label: "What skills can you contribute?",
            description: "Select all that apply",
            required: true,
            options: [
              { value: "frontend", label: "Frontend Development" },
              { value: "backend", label: "Backend Development" },
              { value: "mobile", label: "Mobile Development" },
              { value: "design", label: "UI/UX Design" },
              { value: "devops", label: "DevOps/Infrastructure" },
              { value: "product", label: "Product Management" },
              { value: "community", label: "Community Building" },
              { value: "other", label: "Other" },
            ],
          },
          {
            id: "time_commitment",
            type: "select",
            label: "How much time can you commit monthly?",
            required: true,
            options: [
              { value: "5-10", label: "5-10 hours" },
              { value: "10-20", label: "10-20 hours" },
              { value: "20-40", label: "20-40 hours" },
              { value: "full-time", label: "Full-time" },
            ],
          },
          {
            id: "coop_interest",
            type: "radio",
            label: "Why are you interested in cooperative ownership?",
            required: true,
            options: [
              { value: "ownership", label: "Want ownership in what I build" },
              { value: "mission", label: "Believe in the mission" },
              { value: "community", label: "Want to work with community" },
              { value: "all", label: "All of the above" },
            ],
          },
          {
            id: "motivation",
            type: "textarea",
            label: "Why do you want to join Unity Coop? (Optional)",
            placeholder: "Tell us about your interest in building cooperative technology...",
            required: false,
            validation: { maxLength: 500 },
          },
        ],
      },
    });
    console.log("  ✓ Updated Cahootz coop display info");
  } else {
    console.log("  ⚠ Cahootz coop config not found");
  }
}

console.log("Seeding coop display information...");

seedCoopDisplayInfo()
  .then(() => {
    console.log("\nDone!");
  })
  .catch((e) => {
    console.error("Error seeding coop display info:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
