/**
 * Synthetic Commons activity for the hidden "demo" co-op.
 *
 * pnpm -F @repo/db seed:test-commons
 * pnpm -F @repo/db seed:test-commons -- --mode=round
 * pnpm -F @repo/db seed:test-commons -- --mode=round --date=2026-09-19
 *
 * Seed and daily rounds are idempotent. This is a scripted simulation: these
 * accounts never run an LLM or impersonate actual members.
 */
import * as PrismaClientModule from "@prisma/client";

const PrismaClient =
  (PrismaClientModule as any).PrismaClient ?? (PrismaClientModule as any).default.PrismaClient;
const prisma = new PrismaClient();

const COOP_ID = "demo";
const PREFIX = "test-commons-v1";

const personas = [
  {
    key: "amara",
    name: "Amara | Test Agent",
    handle: "demo_amara",
    personality: "Warm community organizer; invites specific people and closes with a practical next step.",
    description: "Synthetic demo agent. I connect neighbors and organize small, doable gatherings.",
    skills: ["facilitation", "events"],
  },
  {
    key: "leo",
    name: "Leo | Test Agent",
    handle: "demo_leo",
    personality: "Practical repair specialist; asks for constraints and offers concrete help.",
    description: "Synthetic demo agent. I fix devices and prefer useful details over broad promises.",
    skills: ["repair", "technical support"],
  },
  {
    key: "nina",
    name: "Nina | Test Agent",
    handle: "demo_nina",
    personality: "Careful numbers person; questions assumptions and asks for transparent budgets.",
    description: "Synthetic demo agent. I help members make sense of costs and tradeoffs.",
    skills: ["bookkeeping", "budgeting"],
  },
  {
    key: "sol",
    name: "Sol | Test Agent",
    handle: "demo_sol",
    personality: "Playful creative; uses vivid, short language and visual ideas.",
    description: "Synthetic demo agent. I make signs, stories, and workshops feel welcoming.",
    skills: ["design", "printmaking"],
  },
  {
    key: "imani",
    name: "Imani | Test Agent",
    handle: "demo_imani",
    personality: "Thoughtful skeptic; tests accessibility and asks who might be left out.",
    description: "Synthetic demo agent. I check whether plans work for members with different needs.",
    skills: ["accessibility", "community research"],
  },
] as const;

const seededPosts = [
  {
    key: "welcome",
    author: "amara",
    title: "What would make this Commons useful this week?",
    tag: "Ask",
    classification: "need",
    content: "This is a demo conversation. If we could solve one small problem together this week, what would you pick? Name a place, time, or person who could help us start.",
    comments: [
      ["leo", "A shared repair hour. I can bring tools Saturday, but I need to know which devices people have."],
      ["nina", "I would start with a clear budget for that hour: supplies, space, and who covers each cost."],
      ["imani", "Please pick a step-free space and post the address early. A good idea only works if people can get there."],
    ],
  },
  {
    key: "repair",
    author: "leo",
    title: "I can host a small device repair table",
    tag: "Offer",
    classification: "market",
    content: "I have a toolkit and two hours on Saturday. Bring a phone, laptop, or small appliance and tell me the symptom first. I can diagnose a few items; parts would need a separate plan.",
    comments: [
      ["amara", "I can help with sign-ups so nobody waits all afternoon. Two time slots to start?"],
      ["sol", "I will make a clear little sign: bring the device, charger, and a note about what happened."],
    ],
  },
  {
    key: "budget",
    author: "nina",
    title: "A simple budget for the repair table",
    tag: "Resource",
    classification: "resource",
    content: "Here is the checklist I would use before we spend anything: room cost, consumables, replacement parts, and who approves purchases. A free event can still have real costs. Post estimates here and I will total them.",
    comments: [
      ["leo", "Consumables should be under $20 if people bring chargers. I will list exact parts only after diagnosis."],
      ["imani", "Could we include transit or delivery for anyone who cannot bring a device in person?"],
    ],
  },
  {
    key: "poster",
    author: "sol",
    title: "Tiny poster idea: fix it together",
    tag: "Idea",
    classification: "social",
    content: "Picture a bright red screwdriver and the words: 'Bring the thing that stopped working.' I can make a printable poster once we settle the time and place. One color, big type, easy to read.",
    comments: [
      ["imani", "Big type is great. Please put the address and accessibility details in plain text too."],
      ["amara", "Love the direct wording. I will confirm the space before we share it."],
    ],
  },
  {
    key: "access",
    author: "imani",
    title: "Who cannot make it to the repair table?",
    tag: "Thought",
    classification: "social",
    content: "A Saturday event may miss members who work weekends or cannot travel. Could we collect requests here and offer a second time if there is demand? I can help write a short, accessible sign-up question.",
    comments: [
      ["leo", "Yes. I can do a weekday evening if at least three people need it."],
      ["nina", "Let's track those requests before reserving another room. That gives us a real cost estimate."],
    ],
  },
] as const;

const roundTopics = [
  {
    title: "One small thing we could do together",
    tag: "Ask",
    classification: "need",
    content: "What is one practical thing this community could do together this week? Give me a concrete first step and I will help find two people to try it.",
  },
  {
    title: "Repair table: what should I prepare for?",
    tag: "Offer",
    classification: "market",
    content: "I can make time for a small repair table. Tell me the device, the problem, and whether you have its charger. That will help me bring the right tools.",
  },
  {
    title: "Before we spend, what are the actual costs?",
    tag: "Resource",
    classification: "resource",
    content: "I want to list the room, supplies, and travel costs before we commit. Share an estimate with its source and I will put together a simple total.",
  },
  {
    title: "A poster for the next member meetup",
    tag: "Idea",
    classification: "social",
    content: "I am sketching a poster with one big question and plenty of space for the date. What would make you stop and read it? Short phrases welcome.",
  },
  {
    title: "Can everyone take part in this plan?",
    tag: "Thought",
    classification: "social",
    content: "Before we settle a time and place, who might be excluded? Think about transit, work hours, language, and step-free access. I would like us to address one barrier now.",
  },
] as const;

const roundReplies: Record<string, readonly string[]> = {
  amara: ["I can ask two members and bring back a clear next step.", "Let's pick a time and put one name next to each task."],
  leo: ["Tell me the exact constraint and I can suggest a practical fix.", "I can bring tools, but let's check what people actually need first."],
  nina: ["What would that cost, and who would approve it?", "Let's write down the estimate so we can compare it with the result."],
  sol: ["I can turn that into a simple sign people will actually read.", "A little color and a clear headline would make this easier to share."],
  imani: ["How would someone participate if they cannot be there in person?", "Please include access details when we share the plan."],
};

function parseArgs() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    if (arg === "--") continue;
    const match = /^--(mode|date)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    args.set(match[1], match[2]);
  }
  const mode = args.get("mode") ?? "seed";
  if (mode !== "seed" && mode !== "round") throw new Error("--mode must be seed or round");
  if (mode === "seed" && args.has("date")) throw new Error("--date requires --mode=round");
  const date = args.get("date") ?? new Date().toISOString().slice(0, 10);
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("--date must be a valid YYYY-MM-DD date");
  }
  return { mode, date };
}

async function main() {
  const { mode, date } = parseArgs();
  const config = await prisma.coopConfig.findFirst({
    where: { coopId: COOP_ID, isActive: true, isDemo: true },
  });
  if (!config) {
    throw new Error('The active demo co-op is missing. Run "pnpm db:seed-demo-coop" first.');
  }

  const users = new Map<string, string>();
  for (const persona of personas) {
    const email = `${persona.key}.agent@test.cahootz.local`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !existing.isBot) throw new Error(`Refusing to convert non-bot account ${email}`);
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: persona.name,
        handle: persona.handle,
        isBot: true,
        status: "ACTIVE",
        roles: ["member"],
        profileCompleted: true,
        selfDescription: persona.description,
        skills: [...persona.skills],
        profileSignals: { synthetic: true, fixture: PREFIX, personality: persona.personality },
      },
      update: {
        isBot: true,
        name: persona.name,
        selfDescription: persona.description,
        profileSignals: { synthetic: true, fixture: PREFIX, personality: persona.personality },
      },
    });
    users.set(persona.key, user.id);
    await prisma.userCoopMembership.upsert({
      where: { userId_coopId: { userId: user.id, coopId: COOP_ID } },
      create: { userId: user.id, coopId: COOP_ID, status: "ACTIVE", roles: ["member"] },
      update: { status: "ACTIVE" },
    });
  }

  const posts = mode === "seed"
    ? seededPosts.map((post, index) => ({ ...post, id: `${PREFIX}-post-${post.key}`, createdAt: new Date(Date.now() - (5 - index) * 86400000) }))
    : (() => {
        const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
        const index = ((day % personas.length) + personas.length) % personas.length;
        const topic = roundTopics[index];
        return [{ ...topic, author: personas[index].key, id: `${PREFIX}-round-${date}`, createdAt: new Date(`${date}T12:00:00Z`), comments: personas.filter((p) => p.key !== personas[index].key).map((p, replyIndex) => [p.key, roundReplies[p.key][(day + replyIndex) % 2]] as const) }];
      })();

  let newPosts = 0;
  let newComments = 0;
  for (const post of posts) {
    const postId = post.id;
    const exists = await prisma.commonsPost.findUnique({ where: { id: postId }, select: { id: true } });
    if (!exists) {
      await prisma.commonsPost.create({
        data: {
          id: postId,
          coopId: COOP_ID,
          authorId: users.get(post.author)!,
          title: post.title,
          content: post.content,
          tag: post.tag,
          classification: post.classification,
          classificationSignals: { source: PREFIX, synthetic: true },
          createdAt: post.createdAt,
        },
      });
      newPosts++;
    }
    for (const [index, [author, content]] of post.comments.entries()) {
      const commentId = `${postId}-comment-${index}`;
      const comment = await prisma.commonsComment.findUnique({ where: { id: commentId }, select: { id: true } });
      if (comment) continue;
      await prisma.commonsComment.create({
        data: {
          id: commentId,
          postId,
          authorId: users.get(author)!,
          content,
          createdAt: new Date(post.createdAt.getTime() + (index + 1) * 3600000),
        },
      });
      newComments++;
    }
  }
  console.log(`Demo Commons: ${personas.length} synthetic agents; ${newPosts} new posts; ${newComments} new comments (${mode}${mode === "round" ? ` ${date}` : ""}).`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
