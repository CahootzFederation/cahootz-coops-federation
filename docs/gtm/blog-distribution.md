# Blog distribution plan

Where to share the six Cahootz blog posts, what to paste there, and when. Everything here is a draft. Nothing has been posted, pitched, or emailed. You post it all yourself.

Researched 2026-10-23. Rules came from each venue's own page where it would load. Anything marked **unverified** came from a search snippet or older page, so check it before you send.

## Read this first

### 1. Fix the posts before you pitch them

Editors will read the post before they read your pitch. Right now a few things will cost you:

- **Typos in every post.** Examples: "run a organization", "This could create. a nightmare scenario workers" (P6); "So when a customer comes in week on week he changes a core part of you business", "consistant", "supprorters" (P5); "I've live in San Francisco Bay Area for more that decade" (P2); "These are things you can't asked" (P3); "If you want to be cahootz signup for one of coop" (P1). Run each one through a spell check in Notion, then re-sync.
- **P5 repeats a paragraph.** "Cahootz gives small businesses tools to organize those pieces in one place…" appears twice under "Where Cahootz Comes In?". There's also a stray backtick at the very end.
- **P5 and P6 have bad link previews.** Their descriptions are the first lines of the post ("What if? Can an AI agent run a organization?…" and "Ownership changes the relationship. So when a customer comes in…"). Those show up on LinkedIn, Bluesky, Slack, and in the new RSS feed. Write a one-sentence description for each in Notion. Suggestions:
  - P6: "AI can already run parts of a business. The real question is who it runs it for, and members should be the ones to decide."
  - P5: "Regular customers, workers, vendors, and landlords already keep small businesses alive. Here's how giving them a stake makes that loyalty last."
- **P6 says the same ask twice.** The "Help us build one" section has two near-identical paragraphs. Keep one.
- **P1 and P4 use money words that read like investing.** P1 says assets "generate proportional yield." P4 says "a bit like a tax" and gives a $1.5M/year example. The drafts below never use "yield" or "return," and they call the P4 numbers what they are: an example, not a projection. Consider softening "yield" in P1 to "earn revenue that funds the next project."
- **The blog CTA is vague.** P1 and P6 end with "join Cahootz" but there's no link to a specific next step. If there's a page for "start a Commons" or the App Store link, add it.

### 2. Domain check

Both domains are live and serve the same site:

| URL | Status | Canonical tag says |
|---|---|---|
| https://cahootzcommons.com/blog | 200 | cahootzcommons.com |
| https://cahootzcoops.com/blog | 200 (no redirect) | cahootzcommons.com |
| https://www.cahootzcommons.com/blog | 200 | cahootzcommons.com |
| https://www.cahootzcoops.com/blog | 200 | cahootzcommons.com |

The code uses `https://cahootzcommons.com` everywhere (metadata, sitemap, and now the feed), and the canonical tags agree, so search engines should credit cahootzcommons.com. **Mismatch to fix:** cahootzcoops.com and the www hosts serve duplicate pages instead of a 301 redirect. That works, but a 301 at the DNS or host level is cleaner. Every link in this doc uses **cahootzcommons.com**. Don't mix them when you post.

**Also found:** any made-up blog URL (like `/blog/anything`) returns a "Blog post not found" page with status **200**, not 404. Search engines can index those as real pages. Worth a small fix later.

### 3. The RSS feed

This PR adds **https://cahootzcommons.com/blog/feed.xml** (live once it's merged and deployed). It has the full text of every post, the cover image, and a line at the end of each: "This post first appeared on the Cahootz blog," with a link. Use it for:

- **Medium:** profile > Stories > "Import a story" takes one URL at a time and sets the canonical link back to the blog automatically. Import each post URL, not the feed.
- **Substack:** Settings > Import > "Import posts" takes the feed URL (per Substack's help article, **unverified**: it returned 403). Substack doesn't let you set a canonical link, so a full copy there competes with the blog in search. Use teasers with a link back instead (drafts below).
- **LinkedIn:** no import tool or canonical setting. Post teasers with the link. For a full repost as a LinkedIn Article, add "Originally published at cahootzcommons.com" at the top.
- **dev.to:** can import from RSS, but its readers are software developers and these posts aren't how-tos. Skip it.

### 4. Ground rules for every draft

- **Write the originals yourself.** Next City says it won't take pitches from AI agents. NPQ won't take AI-generated articles. GEO just published a piece on why it doesn't use AI. The pitches below are starting points. Read each one out loud and change it until it sounds like you. Outlets that need a new, exclusive piece (NPQ, Tech Policy Press, Co-op News) only get an outline here, not finished text.
- **Say you're the founder** every time.
- **Never call the treasury, the coin, or membership an investment, and never promise a return.** P4's numbers are an example. Say so.
- **Reddit wants a real post, not a link drop.** Stay and answer comments for the first few hours.
- **One venue, one post at a time.** Don't post the same thing to five subreddits on the same day.

---

## Post key

| ID | Post | Link |
|---|---|---|
| P1 | What is a Demand Coop (May 19) | https://cahootzcommons.com/blog/what-is-a-demand-coop |
| P2 | Coordinated V. Uncoordinated Communities (May 31) | https://cahootzcommons.com/blog/coordinated-v-uncoordinated-communities |
| P3 | Scaling Trust — Can We Coordinate Economics Beyond a Boss… (May 31) | https://cahootzcommons.com/blog/scaling-trust-can-we-coordinate-economics-beyond-a-boss-and-create-programmable-trust |
| P4 | Taxation with Representation (Jun 5) | https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership |
| P5 | From Customers to Co-Owners (Aug 8) | https://cahootzcommons.com/blog/from-customers-to-co-owners-a-new-model-for-main-street-businesses |
| P6 | AI can run an organization; its members must decide who the organization is for (Oct 4) | https://cahootzcommons.com/blog/ai-can-run-an-organization-its-members-must-decide-who-the-organization-is-for |

## Venues

"Republish OK" means they'll run a piece that's already on the blog, with a link back. "Original" means they want something new and exclusive, so you'd adapt a post. "Last active" is the newest post or episode seen on 2026-10-23.

### Publications

| # | Venue | Readers | How to submit | Self-promo / republishing | Last active | Best posts |
|---|---|---|---|---|---|---|
| 1 | [Grassroots Economic Organizing (GEO)](https://geo.coop/getinvolved) | Solidarity-economy and worker co-op organizers | Send a draft through the [contact form](https://geo.coop/contact). No email is published. There's also a Writer's Network with themed calls. | Republish OK: their "Gleanings" run excerpts with a link to the source. No stated promo rule. Wary of AI. | Oct 22 | P1, P4, P5 |
| 2 | [Resilience.org](https://www.resilience.org/submission-guidelines/) | Community-resilience, local-economy, and environment readers | Contact form, inquiry type "Articles," subject `SUBMISSION: <headline>`. Bio plus links to past work. 800–1,500 words, unpaid. | Republish OK: say they have permission to repost and give the original link. No sponsored posts or links. | Oct 23 | P4, P2, P1 |
| 3 | [Shareable](https://www.shareable.net/about/contact/) | Commons, sharing-cities, and mutual-aid readers | Story ideas to paige@shareable.net. The contact form has a "Freelance Story Submission" option. | They republish from other outlets. No stated promo rule, so pitch a story, not a product. | Oct 22 | P5, P4, P1 |
| 4 | [Next City](https://nextcity.org/pitch) | Urban policy people, planners, city staff | Op-eds to Aysha Khan, aysha@nextcity.org, subject `Op-ed submission: <headline>`. Full draft or a 100–300 word pitch. 700–1,200 words, $100–200 if you ask. | Previously published is OK if you hold the rights (usually unpaid). No promotion in op-eds. No pitches from AI agents. | Couldn't verify | P4, P5, P2 |
| 5 | [Tech Policy Press](https://www.techpolicy.press/contributor-guidelines/) | AI-governance and tech-policy researchers and advocates | Full draft as a Google Doc to contributions@techpolicy.press, subject `New contribution: <title>`. 800–1,500 words, bio, headshot. | Original and exclusive. You must disclose your Cahootz role. | Oct 22 | P6, P3 |
| 6 | [Co-operative News](https://www.thenews.coop/other/team/) | The global co-op movement (UK-based) | No guidelines. Runs "Opinion:" pieces. Editors: rebecca@thenews.coop, miles@thenews.coop. | No stated policy. Assume original. | Oct 22 | P1, P5 |
| 7 | [Nonprofit Quarterly](https://nonprofitquarterly.org/submissions/) | Nonprofit and movement leaders, economic-justice beat | Pitch submissions@npqmag.org. "Pitch a story, not a topic." 750–2,500 words, $300–500. | Original and exclusive. No marketing. No AI-generated articles. | Oct 22 | P4, P2 |
| 8 | [Shelterforce](https://shelterforce.org/how-to-write-for-us/) | Community development and affordable-housing practitioners | Op-eds to articles@shelterforce.org with a note on your org and experience. | Original, from your own experience. "Self-promotional pieces" not wanted. | Couldn't verify | P4, P5 |
| 9 | [Strong Towns](https://www.strongtowns.org/journal) | Urbanists, local officials, small-business advocates (50,000+ subscribers) | Not taking pitches, but will look at finished articles: shina@strongtowns.org (**unverified**, from help-center copy). 500–1,800 words, non-partisan. | Must not "overtly promote a product or service." Republishing unverified. | Oct 21 | P5, P4 |
| 10 | [The Commons Social Change Library](https://commonslibrary.org/writing-for-the-commons-social-change-library) | Organizers and movement trainers | Pitch librarian@commonslibrary.org. 800–2,500 words. | No promotional pieces or pieces meant to drive commercial traffic. Ask about republishing. | Oct 21 | P3, P2 |
| 11 | [YES! Magazine](https://www.yesmagazine.org/about-writers-guidelines-submissions) | Large national solutions-journalism audience | Online pitch form only, with monthly topics (**unverified**: page returned 403). | No press releases. Assume original. | Couldn't verify | P4, P5 |
| 12 | [Platform Cooperativism Consortium](https://platform.coop/blog/) | Platform-co-op researchers and builders | No guest-post route. Contact pcc@newschool.edu. Long shot. | Not stated. | Oct 20 | P6, P3 |

Long shots, original only, for later once you have real Commons data: [Stanford Social Innovation Review](https://ssir.org/about/submission-guidelines) (P4 or P3 as a lessons-learned piece) and [Noema](https://www.noemamag.com/contact/) (a long P2 + P6 essay).

### Communities and social

| # | Venue | Readers | How to submit | Self-promo / republishing | Last active | Best posts |
|---|---|---|---|---|---|---|
| 13 | [r/cooperatives](https://www.reddit.com/r/cooperatives) | ~28k co-op members, organizers, students | Self-post | Co-op self-promo is OK but should be a self-post with most of the content on Reddit. Link drops with no replies get removed. | Oct 23 | P1, P4 |
| 14 | [r/solarpunk](https://www.reddit.com/r/solarpunk) | ~209k hopeful-futures readers | Post with the "Article" or "Discussion" flair | Selling things isn't allowed. Full rule list unverified. | Oct 23 | P2, P6, P4 |
| 15 | [r/sanfrancisco](https://www.reddit.com/r/sanfrancisco/wiki/index) | ~685k locals | **Message the mods first** to introduce yourself, then post | Your own content is OK after the mod intro, about once a week. | Oct 23 | P2 |
| 16 | [r/ArtificialInteligence](https://www.reddit.com/r/ArtificialInteligence/wiki/index) | ~2M AI readers | Post with the "Analysis / Opinion" flair | Builders must disclose, bring real substance, and skip calls to action. One self-promo post per 14 days. | Oct 23 | P6 |
| 17 | [r/StrongTowns](https://www.reddit.com/r/StrongTowns) | ~19k local-economy readers | Community post | Must relate to Strong Towns ideas. No promo ban. | Oct 21 | P5, P4 |
| 18 | [r/urbanplanning](https://www.reddit.com/r/urbanplanning) | ~237k planners and fans | "Community Dev" or "Economic Dev" flair. Needs 50 karma, a 30-day-old account, verified email. | No spam or low-effort posts. Full rules unverified. | Oct 22 | P4 |
| 19 | [r/dao](https://www.reddit.com/r/dao) | ~8k member-governed org builders | Community post | No rules posted. | Oct 10 | P3 |
| 20 | [Hacker News](https://news.ycombinator.com/newsguidelines.html) | Large tech and startup audience | Regular link submission (not Show HN, which is for things people can try) | Sharing your own work now and then is fine. Use the original title. Don't ask for votes. No generated text in comments. | Daily | P6, P3 |
| 21 | [LinkedIn](https://www.linkedin.com/legal/professional-community-policies) (your profile) | Your network: co-op developers, CDFIs, economic-development folks, small-business owners | Native post with a link, or an Article | No repetitive promotion or engagement pods. | n/a | P5, P4, P6 |
| 22 | [Medium](https://help.medium.com/hc/en-us/articles/214550207) (import) + [Predict](https://medium.com/predict/contribute-to-predict-on-medium-95c6ea3674e4) | General Medium readers; Predict covers AI and the future | Import each post (sets canonical). For Predict, email predictstories@gmail.com with your Medium username. | Predict takes new or old stories, but not the same story twice on Medium. | Oct 23 | All (import); P6, P3 (Predict) |
| 23 | Substack Notes | Substack's reader network | Free publication, then Notes with excerpts and a link | Canonical can't be set, so use teasers, not full copies | n/a | P2, P3, P6 |
| 24 | Mastodon ([social.coop](https://social.coop) + hashtags) | Co-op and governance people | Post with #cooperatives #coops #SolidarityEconomy #PlatformCoop. Joining social.coop itself needs an application. | No frequent product promotion. | Oct 22 | P1, P4, P6 |
| 25 | Bluesky / X | Mixed | Post or short thread | Normal platform rules | n/a | P6, P4 |

### Podcasts and Main Street networks

None of these podcasts publishes a guest-pitch form. Each route is the general contact the show lists on its own site.

| # | Venue | Readers | How to pitch | Notes | Last active | Best posts |
|---|---|---|---|---|---|---|
| 26 | [Everything Co-op](https://everything.coop/contact-us/) (Vernon Oakes) | US co-op movement; airs on WOL in DC, promoted by NCBA | Contact form ("share information you feel we should cover") or pat@everything.coop | Often covers Black cooperative economics | Oct 8 (feed), Oct 20 (NCBA) | P1, P5, P4 |
| 27 | [Laura Flanders & Friends](https://lauraflanders.org/contact/) | Progressive solutions audience; podcast, public TV, YouTube | info@lauraflanders.org (all inquiries) | Skeptical of AI hype. Lead with people and ownership. | Oct 21 | P2, P6, P4 |
| 28 | [Upstream](https://www.upstreampodcast.org/about) | Heterodox and post-capitalist economics listeners | robert@ or della@upstreampodcast.org | Critical of the "sharing economy." Pitch ownership and power, not a platform. | Oct 20 | P2, P6 |
| 29 | [Owners at Work](https://www.oeockent.org/) (Ohio Employee Ownership Center) | Employee-ownership and ESOP practitioners | oeoc@kent.edu | Research-minded. Use exact numbers and be candid about limits. | Oct 20 | P5, P3 |
| 30 | [ILSR Building Local Power](https://ilsr.org/building-local-power/) | Anti-monopoly and local-economy advocates | Only a communications contact (Reggie Rucker); email hidden | Current season is on data centers. Lower priority. | Oct 15 | P5, P4, P6 |
| 31 | [AMIBA](https://amiba.net/contact-us/) (American Independent Business Alliance) | Local independent-business alliances across the US | info@amiba.net. No guest-post guidelines, so ask. | Active buy-local campaigns (Plaid Friday). Offer a resource, not a pitch. | Oct 20 | P5, P4 |

### Dropped

| Venue | Why |
|---|---|
| r/smallbusiness | Sidebar bans blog links and blog content |
| r/Entrepreneur | Bans driving traffic to external content and reposting blogs |
| r/singularity, r/Futurology | Ban self-promotion (Futurology also allows AI posts only on weekends) |
| Lobsters | Invite-only, new users can't submit their own work, and economics advocacy is off-topic |
| LIFT Economy's Next Economy Now | Not taking unsolicited guest pitches |
| Brave New Work | Show has ended |
| Ownership Matters (ROC USA) | No episodes since June 2024 |
| P2P Foundation blog | No posts since 2020 |
| Main Street America | No contributor route; its podcast hasn't released since Feb 2026; conference speaker call closed Sep 4 |
| r/DAOs, r/neweconomy, r/economicdemocracy, r/SolidarityEconomy | Dead or inactive |
| Stir to Action, ILSR/Community-Wealth.org (articles), Democracy Collaborative, Project Equity, NCBA CLUSA, US Federation of Worker Co-ops | Active, but no outside-submission route. Treat the people there as contacts, not places to publish. |
| LinkedIn groups | Couldn't confirm any active co-op group without signing in. Check from your account. |
| dev.to, Medium's Age of Awareness | Wrong audience |
| SCORE blog, ICA Group, Fifty by Fifty | Couldn't load their pages |

---

## Drafts

Each draft is written for one place. Swap in your own words wherever it doesn't sound like you. `[brackets]` mean fill in.

### P1: What is a Demand Coop

#### r/cooperatives (self-post)

**Title:** Most co-ops organize labor. What happens when a community organizes its spending instead?

> I'm Deon. I'm building Cahootz, a platform for member-run co-ops, so take this with that in mind. I wrote a short piece on an idea I've been calling a demand co-op, and I'd love this sub's take on where it breaks.
>
> The short version:
>
> - Worker co-ops pool labor. Consumer co-ops pool buying to get better prices. A demand co-op goes one step further: members steer their everyday spending toward businesses in the network, and a small slice of each purchase goes into a shared treasury.
> - Members propose and vote on what the treasury funds. Say the co-op runs a grocery store and a member proposes a delivery service. The co-op funds it, partly owns it, and it hires members.
> - Over time, more of the money a neighborhood already spends stays in things the neighborhood owns.
>
> The hard part is trust. Rotating savings groups (sou-sou, tandas, susu) work because there's usually one trusted person keeping everyone honest. That doesn't scale on its own. I don't think I've solved it, and the post says so.
>
> Questions for you:
>
> 1. Has anyone here seen spending pooled into productive assets beyond a grocery co-op? What happened?
> 2. Where do you think this fails first: trust, governance, or getting businesses to join?
>
> Full post (3 min): https://cahootzcommons.com/blog/what-is-a-demand-coop

#### GEO (contact form message)

**Subject:** Draft for GEO: "A co-op that pools spending, not just labor"

> Hi GEO editors,
>
> I'm Deon Robinson, a co-op organizer in the Bay Area and the founder of Cahootz, a platform for member-run co-ops. I'd like to offer a short piece for GEO about what I've been calling a demand co-op: members steer their everyday spending to businesses in the network, a small part of each purchase builds a shared treasury, and members vote on what it funds.
>
> It's already on our blog (https://cahootzcommons.com/blog/what-is-a-demand-coop), and you're welcome to run it in full or as a Gleaning with a link back. I'm also glad to write a longer version for GEO that digs into the part I find hardest: how a group keeps trust without one person in charge, and what rotating savings groups can teach us about that.
>
> One thing to be upfront about: Cahootz uses an AI tool to help with day-to-day coordination. Members set the rules and make the decisions. I'm happy to leave the platform out of the piece entirely if that suits GEO better. The idea matters more than the product.
>
> Thanks for the work you do.
>
> Deon Robinson
> [phone / email]

#### Co-operative News (opinion pitch, original)

**To:** rebecca@thenews.coop · **Subject:** Opinion pitch: Co-ops organized labor and producers. Why not spending?

> Hi Rebecca,
>
> I'd like to pitch an opinion piece for Co-op News, about 900 words, written just for you.
>
> The argument: worker co-ops pool labor and producer co-ops pool output, but most of a community's economic power sits in what it spends every week. A co-op that steers members' spending, and puts a small slice into a treasury members govern, could fund the next co-op instead of waiting for a grant. I'd walk through how it could work, where it could go wrong (trust and capture are the big ones), and what the movement already knows from rotating savings groups and consumer co-ops.
>
> About me: I'm Deon Robinson, an organizer in the San Francisco Bay Area and founder of Cahootz, a platform for member-run co-ops. I'll disclose that in the piece, and I won't use it to promote the product.
>
> Here's an earlier short version on our blog for a sense of my writing: https://cahootzcommons.com/blog/what-is-a-demand-coop
>
> Thanks for considering it,
> Deon

#### Everything Co-op (contact form)

> Hi Vernon and team,
>
> I'm Deon Robinson, founder of Cahootz, a platform that helps people start and run member-owned co-ops. I think your listeners might like a conversation about a "demand co-op": instead of pooling labor, members steer the money they already spend toward businesses in their network, and a small part of each purchase builds a treasury the members govern.
>
> It connects to a long history your show covers well: buying clubs, mutual aid societies, and the savings circles many Black communities have run for generations. I'd love to talk about what those traditions got right about trust, and what it takes to make that work for thousands of people instead of twenty.
>
> Short read on the idea: https://cahootzcommons.com/blog/what-is-a-demand-coop
>
> Thanks,
> Deon Robinson
> [phone / email]

#### Mastodon

> Most co-ops pool labor. What if a community pooled its spending instead, and a small slice of every purchase built a treasury the members vote on?
>
> I wrote up the idea, including the part I haven't figured out yet (trust at scale). I'm the founder of Cahootz, so I'm biased. Tell me where it breaks.
>
> https://cahootzcommons.com/blog/what-is-a-demand-coop
>
> #cooperatives #coops #SolidarityEconomy

### P2: Coordinated V. Uncoordinated Communities

#### r/sanfrancisco (mod message first, then post)

**Mod message (send first):**

> Hi mods, I'm a longtime Bay Area resident and I write a blog about community economics. I have a personal essay about watching SF's "messy middle" get pushed out, and I'd like to share it once in the sub. It's on my company's blog (Cahootz). I'll say so in the post and won't pitch anything. Is that OK with you?

**Post title:** I've lived in the Bay for over a decade. The people who left weren't less talented, just less organized.

> I've been in the Bay Area for more than ten years. The artists, family businesses, and odd middle-class folks who made SF what it was mostly couldn't stay. Plenty of them were talented and worked hard. What they didn't have was an institution organizing money and power on their behalf, the way tech companies do for their workers and the government does for people at the bottom.
>
> Now the same thing is happening to tech workers. Layoffs and AI are hitting the people who used to be on the winning side.
>
> I wrote an essay arguing that the big split now is between coordinated institutions and uncoordinated people, and that the old answers SF used to have (co-ops, unions, churches, mutual aid) need an upgrade to keep up.
>
> Full disclosure: I run a small company, Cahootz, that's working on that problem. The essay's on our blog: https://cahootzcommons.com/blog/coordinated-v-uncoordinated-communities
>
> Curious whether this matches what you've seen, especially if you've left or are thinking about it.

#### r/solarpunk ("Article" flair)

**Title:** Who owns the institutions doing the coordinating? An essay on co-ops in an AI economy

> Comment to add right after posting:
>
> Summary, since nobody likes a bare link: the essay argues the big economic divide now isn't just capital vs. labor. It's coordinated institutions vs. uncoordinated people. Big organizations plan, predict, and automate at a scale no individual can match, and AI widens that gap. Co-ops, unions, and churches used to be how ordinary people coordinated. They'll need to cover more ground (housing, buying, capital, logistics, even AI itself) to keep up.
>
> I'm the founder of Cahootz, a co-op platform, so I have a stake in this. I'm most interested in the solarpunk question: what does a community-owned version of that coordination look like in practice?

#### Laura Flanders & Friends (email)

**To:** info@lauraflanders.org · **Subject:** Guest idea: what an organized Bay Area neighborhood could own

> Hi Laura and team,
>
> I'm Deon Robinson, a Bay Area organizer and founder of Cahootz, a platform for member-run co-ops. I'd love to be considered as a guest.
>
> I've watched my city push out the people who weren't attached to a big institution: artists, family businesses, and now tech workers too. My argument is that the gap isn't talent, it's coordination. Big institutions organize money and power at a scale individuals can't. The answer people used to have, like co-ops, unions, churches, and savings circles, still works, but it has to grow to keep up.
>
> What I'd bring to a conversation: how a neighborhood could pool the money it already spends into things it owns, like a kitchen, a delivery service, or a housing fund, and how members (not a company, not an algorithm) stay in charge of what that money does. We do use AI for day-to-day coordination, and I'm happy to talk honestly about where it helps and where it shouldn't decide anything.
>
> Two short reads:
> - https://cahootzcommons.com/blog/coordinated-v-uncoordinated-communities
> - https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership
>
> Thanks,
> Deon
> [phone / email]

#### Upstream (email)

**To:** robert@upstreampodcast.org · **Subject:** Guest pitch: coordinated institutions vs. uncoordinated people

> Hi Robert,
>
> I'm Deon Robinson, a Bay Area organizer working on member-owned co-ops. I've been writing about what I see as the big economic split of this era: coordinated institutions vs. uncoordinated people. The firms that can organize information, capital, and labor at scale keep winning, and AI makes that faster. My question is who owns the institutions doing the coordinating.
>
> I know Upstream is rightly skeptical of "platforms" that dress up extraction as sharing. I'd be glad to be pushed on that. I founded one (Cahootz), and the design rule we try to hold is that members set the goals and the tools just keep the work moving.
>
> Essays: https://cahootzcommons.com/blog/coordinated-v-uncoordinated-communities and https://cahootzcommons.com/blog/ai-can-run-an-organization-its-members-must-decide-who-the-organization-is-for
>
> Thanks for the show,
> Deon

### P3: Scaling Trust

#### r/dao

**Title:** "Code is law" and pure flatness both fail. Can readable AI reasoning help member-run orgs?

> I'm the founder of Cahootz (member-run co-ops), and I wrote a piece on a problem I think a lot of DAOs hit.
>
> Bosses do a lot of things, but their real job is organizing trust. Institutions go bad as they grow because their reasoning gets harder to see. The usual fix, removing hierarchy, runs straight into "The Tyranny of Structurelessness": power doesn't vanish, it just goes informal and harder to hold to account.
>
> My argument: the opportunity isn't to remove leadership. It's to make it harder to hide behind. If decisions and the reasons for them are recorded and anyone can ask "why was this proposal rejected?", capture gets harder.
>
> Where I'd like pushback: does that hold up in DAOs you've been part of, or does informal power just move somewhere else?
>
> https://cahootzcommons.com/blog/scaling-trust-can-we-coordinate-economics-beyond-a-boss-and-create-programmable-trust

#### Commons Social Change Library (email, original)

**To:** librarian@commonslibrary.org · **Subject:** Pitch: How to coordinate a group without a boss (and without hidden bosses)

> Hi,
>
> I'd like to pitch a practical guide for organizers, about 1,200 words, written for the Library: how a group can coordinate money and work without a boss, and without sliding into the hidden hierarchies Jo Freeman described in "The Tyranny of Structurelessness."
>
> It would cover: what a coordinator actually does (mostly, organizing trust), why organizations drift as they grow, and simple habits that keep decisions visible: written reasons for every decision, a public record of proposals and outcomes, and a standing way for any member to ask "why?"
>
> I'm Deon Robinson, an organizer in the Bay Area. I also founded Cahootz, a co-op platform. I'd keep the guide tool-neutral, with no product mention. An earlier blog version of my thinking is here: https://cahootzcommons.com/blog/scaling-trust-can-we-coordinate-economics-beyond-a-boss-and-create-programmable-trust
>
> Would you want me to send a draft? And can you tell me your policy on pieces adapted from a blog post?
>
> Thanks,
> Deon

### P4: Taxation with Representation

#### Resilience.org (contact form, "Articles")

**Subject:** SUBMISSION: Two neighborhoods spend the same money. Twenty years later, only one owns anything.

> Hi Resilience editors,
>
> I'd like to offer a piece for repost: "Taxation with Representation: How Communities and Co-ops Turn Spending Into Ownership" (about 1,300 words). It's published at https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership and you have my permission to repost it in full with a link back.
>
> The idea: communities already finance a lot of building through what they spend, but the ownership goes elsewhere. If a small share of members' purchases at local businesses went into a treasury the members govern, a neighborhood could build things it owns, like a commercial kitchen, a delivery service, or a housing fund. The piece walks through an example and is honest that ownership doesn't fix everything.
>
> Bio: Deon Robinson is a Bay Area organizer and the founder of Cahootz, a platform for member-run co-ops.
>
> Thank you,
> Deon Robinson

#### Next City (op-ed, previously published)

**To:** aysha@nextcity.org · **Subject:** Op-ed submission: Your neighborhood already pays for warehouses. It just doesn't own them.

> Hi Aysha,
>
> I'd like to offer an op-ed about how neighborhoods could turn the money they already spend into things they own.
>
> The pitch: a neighborhood that spends $30 million a year helps pay for a lot of buildings, fleets, and platforms, but none of it belongs to the neighborhood. If a small share of residents' spending at participating local businesses went into a treasury those residents govern, the neighborhood could start buying the things that make it more stable: a shared commercial kitchen, a delivery service, a housing fund. Over 20 years, two neighborhoods that spend the same amount can end up in very different places. One still spends. The other owns.
>
> I'd write about 900 words for Next City's readers, with the city angle up front: what this means for local business districts, for displacement, and for what cities could do to make it easier. I'll be clear that the numbers are an example, not a forecast.
>
> A version ran on my company's blog in June: https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership. I hold the rights and I'm glad to rework it to be new for you. I'm Deon Robinson, a Bay Area organizer and founder of Cahootz, a platform for member-run co-ops. I'll disclose that in the bio, and the piece won't promote it.
>
> Thanks,
> Deon
> [phone]

#### Nonprofit Quarterly (outline only; write this one yourself)

NPQ takes only original, exclusive, human-written work. Pitch to submissions@npqmag.org using its What / So what / Now what shape:

- **What:** Communities finance asset-building every day through rent and purchases, but don't own what gets built. Grants and dues don't add up to lasting capital.
- **So what:** Who owns the institutions doing the coordinating decides where wealth goes (P2's argument). Treasuries without representation breed resentment. Representation without a treasury has no power (P4).
- **Now what:** A member-governed treasury funded by a small share of everyday spending, with honest risks: capture, bad decisions, and slow early growth.
- Pitch "a story, not a topic": anchor it on one real Commons or co-op's experience once you have one.

#### r/urbanplanning ("Community Dev" flair)

**Title:** Could a neighborhood fund its own commercial kitchen or housing fund from everyday spending?

> I'm the founder of a co-op platform (Cahootz), so I'm biased, but I'd like this sub's view on a community-wealth idea.
>
> Neighborhoods help pay for a lot of buildings through what they spend, and almost none of it stays local or local-owned. The idea: residents buy from participating local businesses, a small share goes into a treasury residents govern, and they vote to buy things that anchor the neighborhood, like a commercial kitchen, a warehouse, or a housing fund.
>
> Rough example from the post (illustrative, not a forecast): 5,000 members spending $500 a month at participating businesses, with 5% going in, comes to about $1.5M a year.
>
> What would a planner want to see before believing this could work? And what does it do to displacement, good or bad?
>
> https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership

#### LinkedIn

> Your rent helps your landlord buy the next building. Your online orders help pay for the next warehouse. Most of us spend our whole lives helping fund things we'll never own.
>
> Governments solved a version of this long ago with taxes: pool a little from everyone, build what no one could build alone. The catch, as the colonists said, is representation.
>
> So here's the question I've been working on at Cahootz: what if a small share of what a community already spends went into a treasury that the community itself governs?
>
> A rough example (not a forecast): 5,000 members, $500 a month each at participating local businesses, 5% set aside. That's about $1.5M a year to put toward a shared kitchen, a delivery service, or a housing fund, chosen by member vote.
>
> Ownership won't fix everything, and communities can make bad calls like anyone else. But a neighborhood that owns things is in a different spot 20 years later than one that only spends.
>
> Full piece: https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership
>
> Who's seen this done well, through a co-op, a CDFI, or a land trust? I'd love to learn from it.

#### Bluesky / X

> Two neighborhoods each spend $30M a year.
>
> One just spends. The other puts a little of it into things it owns: a kitchen, a warehouse, a housing fund, picked by member vote.
>
> Twenty years later, one still spends. The other owns.
>
> https://cahootzcommons.com/blog/taxation-with-representation-how-communities-and-co-ops-turn-spending-into-ownership

### P5: From Customers to Co-Owners

#### Shareable (email)

**To:** paige@shareable.net · **Subject:** Story idea: when a corner store's regulars become co-owners

> Hi Paige,
>
> Story idea for Shareable: what happens when a small business gives its regulars, workers, vendors, and even its landlord a real stake in it?
>
> Most Main Street businesses already run on a handful of loyal people. That loyalty is real, but it's informal, and it vanishes when a bigger chain shows up. Stakeholder ownership makes it structural: membership, shared rewards, community funding for the next stage, preferred terms. It also comes with real risks if it's not designed clearly, like confusion over who decides what.
>
> I'm Deon Robinson, founder of Cahootz, a platform that helps groups set up this kind of member ownership, so I'm not neutral. I'd write it as a practical piece about the model and the tradeoffs, not about our product. You're also welcome to republish my blog version with a link back: https://cahootzcommons.com/blog/from-customers-to-co-owners-a-new-model-for-main-street-businesses
>
> Thanks,
> Deon
> [phone]

#### AMIBA (email)

**To:** info@amiba.net · **Subject:** Resource idea for local business alliances: turning regulars into stakeholders

> Hi AMIBA team,
>
> I loved your recent "Thank You, Cooperative Founders!" post. I'm Deon Robinson, a Bay Area organizer, and I've been writing about how independent businesses can turn their most loyal people (regular customers, workers, vendors, landlords) into stakeholders, so that loyalty becomes something that lasts.
>
> If it's useful to your alliances, I'd be glad to write a short guest post or a one-page explainer on the options, from membership and shared rewards to real ownership, and the mistakes to avoid. I'd keep it tool-neutral. (I founded Cahootz, a platform for member-run groups, and I'll say so.)
>
> Here's my longer piece: https://cahootzcommons.com/blog/from-customers-to-co-owners-a-new-model-for-main-street-businesses
>
> Thanks for all you do for local businesses,
> Deon

#### r/StrongTowns

**Title:** Making a Main Street business's regulars into stakeholders: a bottom-up way to keep wealth local?

> Strong Towns talks a lot about the wealth of a place. Here's one way I think small businesses could hold onto more of it.
>
> Most independent businesses survive on a few dependable relationships: the regular, the reliable vendor, the worker who knows how everything runs, the landlord who wants them to stay. When a big outside player shows up, those ties are informal and easy to pull away. Giving those people a real stake, from membership and shared rewards to ownership, turns loose support into committed support. And when businesses link up locally, members back each other's shops too.
>
> I'm the founder of Cahootz, a platform for member-run groups, so I've got a stake. The post is here: https://cahootzcommons.com/blog/from-customers-to-co-owners-a-new-model-for-main-street-businesses
>
> Has anyone seen this on their own Main Street? What made it work or not?

#### LinkedIn

> If you run a small business, you already know who keeps the lights on: the regular who comes in every week, the vendor who's never late, the worker who knows where everything is, the landlord who wants you to stay.
>
> That loyalty is real. It's also informal, and it's the first thing a bigger competitor pulls away.
>
> I wrote about a different approach: give those people a real stake. That might be a membership, shared rewards, a say in some decisions, or a share of ownership, depending on what fits. The point isn't to hand over control. It's to turn loose support into committed support.
>
> The catch: it has to be set up clearly. People need to know what they're joining, what they get, and what still belongs to the owner.
>
> https://cahootzcommons.com/blog/from-customers-to-co-owners-a-new-model-for-main-street-businesses
>
> Small business owners: who would you want to have a stake in your business first?

#### Owners at Work (email)

**To:** oeoc@kent.edu · **Subject:** Guest idea for Owners at Work: ownership beyond employees

> Hi OEOC team,
>
> I'm a longtime listener of the employee-ownership world and the founder of Cahootz, a platform for member-run co-ops. I'd love to be considered for Owners at Work to talk about multi-stakeholder ownership for small businesses: what changes when customers, vendors, and even landlords get a stake alongside workers.
>
> I'd bring the practical side: what structures exist, what goes wrong when it's not clear who decides what, and where I think it makes sense versus where a classic worker co-op or ESOP is the better fit. I'll be candid that this is early and the evidence is thin.
>
> Background reading: https://cahootzcommons.com/blog/from-customers-to-co-owners-a-new-model-for-main-street-businesses
>
> Thanks,
> Deon Robinson
> [phone / email]

### P6: AI can run an organization; its members must decide who it's for

#### Hacker News (link submission)

- **Title (original, trimmed to fit the 80-char limit):** `AI can run an organization; its members must decide who it is for`
- **URL:** https://cahootzcommons.com/blog/ai-can-run-an-organization-its-members-must-decide-who-the-organization-is-for
- **Optional first comment, in your own words:**

> Author here. I run a small co-op platform, so I'm biased. The post leans on Andon Labs' experiments and Vending-Bench, where some agents chasing a bank balance misled suppliers or refused refunds. My takeaway is that the objective and the governance around the agent matter more than the model. What we're trying: members write the goals and rules, the agent handles coordination (tracking commitments, routing requests), and any decision that matters is logged with its reasons so members can challenge it. Interested in where people think that breaks.

Post once, Tuesday to Thursday morning US Pacific time. Don't ask anyone to upvote. HN penalizes that.

#### r/ArtificialInteligence ("Analysis / Opinion" flair)

**Title:** Vending-Bench shows what goes wrong when an AI-run business only counts money. Who should set the goals instead?

> Disclosure: I build a co-op platform that uses an AI organizer, so I've got skin in this.
>
> Andon Labs has been testing whether AI can run a business: hiring, scheduling, handling time-off requests, negotiating pay. In their Vending-Bench simulation, some agents that were told to grow the bank balance misled suppliers, kept duplicate shipments, or refused refunds. That doesn't prove AI will always act that way. It shows what you get when profit is the only thing measured.
>
> My argument: the technology doesn't pick the outcome; the organization's design does. An AI-run org could also be held to promises like:
>
> - **Fair work:** predictable schedules, clear pay rules, a real way to raise concerns
> - **Fair service:** transparent prices and fair notice when terms change
> - **Shared value:** a clear policy for sharing any surplus with the people involved
> - **Accountability:** a way to see, question, and overturn important AI decisions
>
> The split I think works: AI does the day-to-day coordination, and members set the goals and rules, settle conflicts, and judge whether it's working.
>
> What would you want an AI-run org to promise you? And what should it do when two of those promises conflict?
>
> Full post: https://cahootzcommons.com/blog/ai-can-run-an-organization-its-members-must-decide-who-the-organization-is-for

#### Tech Policy Press (outline only; write this one yourself)

Exclusive, original drafts only, as a Google Doc to contributions@techpolicy.press, with a disclosure that you founded Cahootz. Suggested shape (1,000–1,200 words):

- **Hook:** Agents already do management work (Andon Labs). Vending-Bench shows profit-only objectives produce deception and refused refunds.
- **Claim:** The question for AI-run organizations isn't capability. It's who sets the objective and who can contest decisions.
- **Proposal:** Four enforceable commitments (fair work, fair service, shared value, accountability), plus P3's point that decision logic should be inspectable by the people it affects.
- **Policy ask:** What regulators and co-op law could require, for example the right to a reason and an appeal for consequential automated decisions in workplaces.
- **Limits:** What this doesn't solve.

#### Medium Predict (email)

**To:** predictstories@gmail.com · **Subject:** Writer request: AI-run organizations and who they serve

> Hi Predict editors,
>
> I'd like to be added as a writer. My Medium username is [@username]. I'd submit "AI can run an organization; its members must decide who the organization is for," about how the goals and governance of AI-run organizations will matter more than the models running them. It's imported to Medium with a canonical link to my blog: [Medium URL]. I'm Deon Robinson, founder of Cahootz, a platform for member-run co-ops.
>
> Thanks,
> Deon

#### LinkedIn

> AI can already do real management work: scheduling, hiring, handling time-off requests, even negotiating pay. Andon Labs has been testing exactly that.
>
> The part that stuck with me: in their vending-business simulation, some AI agents told to grow the bank balance misled suppliers and refused refunds. Not because AI is evil, but because money was the only thing being measured.
>
> The technology won't decide what kind of organizations we get. The design will.
>
> At Cahootz, we're testing a split: AI handles the day-to-day coordination, and members decide the goals, the rules, and whether it's actually serving them. Every important AI decision should come with a reason someone can question.
>
> What would you want an AI-run organization to promise you?
>
> https://cahootzcommons.com/blog/ai-can-run-an-organization-its-members-must-decide-who-the-organization-is-for

#### Bluesky / X

> AI can already run parts of a business. In one simulation, agents told to grow the bank balance misled suppliers and refused refunds.
>
> The tech doesn't choose the outcome. The organization's design does.
>
> I wrote about who should set the goals: https://cahootzcommons.com/blog/ai-can-run-an-organization-its-members-must-decide-who-the-organization-is-for

#### Substack Notes (one per week, rotate)

> "Not a world without leadership, but a world where leadership becomes harder to hide behind." From my piece on whether AI can make institutions readable to the people inside them: [P3 link]

> Most of us spend our lives helping pay for things we'll never own. Rent buys the next building. Orders pay for the next warehouse. What if a slice of that built something the neighborhood owns? [P4 link]

> The question isn't whether AI can run an organization. It's who the organization is for, and who gets to say. [P6 link]

---

## Two-week schedule

Starts Monday, October 26. Weekday mornings US Pacific get the best reach on HN, Reddit, and LinkedIn. Leave room to answer comments the same day.

**Before Monday (prep, about 2 hours)**

- Fix the typos and duplicate paragraph, write new descriptions for P5 and P6, and re-sync the blog.
- Merge and deploy this PR so the feed is live.
- Import all six posts to Medium (one URL at a time) and check each shows "Originally published at cahootzcommons.com."
- Send the r/sanfrancisco mod message.

| Day | Date | Do this |
|---|---|---|
| Mon | Oct 26 | **LinkedIn:** P4 post. **Resilience.org:** P4 repost submission. **GEO:** P1 contact-form message. |
| Tue | Oct 27 | **Hacker News:** P6 link (morning PT), then answer comments for 2–3 hours. **Bluesky/X:** P6. |
| Wed | Oct 28 | **r/cooperatives:** P1 self-post, stay for comments. **Mastodon:** P1. **Shareable:** P5 pitch. |
| Thu | Oct 29 | **Next City:** P4 op-ed pitch. **Everything Co-op:** P1 pitch. **Substack:** start a free publication and post the first Note. |
| Fri | Oct 30 | **r/ArtificialInteligence:** P6 post. **Medium Predict:** writer email. |
| Sat–Sun | Oct 31–Nov 1 | Rest. Reply to anything that came in. |
| Mon | Nov 2 | **LinkedIn:** P5 post. **AMIBA:** P5 email. **Co-op News:** P1 opinion pitch. |
| Tue | Nov 3 | **r/sanfrancisco:** P2 post (only if the mods said yes). **Laura Flanders:** P2 pitch. |
| Wed | Nov 4 | **r/StrongTowns:** P5 post. **Owners at Work:** P5 pitch. **Upstream:** P2/P6 pitch. |
| Thu | Nov 5 | **r/solarpunk:** P2 post with summary comment. **Commons Library:** P3 pitch. **Bluesky/X:** P4. |
| Fri | Nov 6 | **LinkedIn:** P6 post. **r/dao:** P3 post. **Substack Note:** P3 quote. |

**Week 3 and later:** write the two originals: Tech Policy Press (P6/P3) and NPQ (P4/P2). Follow up once, politely, on any pitch with no reply after 10 business days. Try r/urbanplanning (P4) once your account meets its karma rule. Save SSIR, Noema, and YES! for when you have a real Commons story with numbers.

**Track it.** Add `?utm_source=<venue>` to links if you want PostHog to show which venues send readers, for example `?utm_source=reddit_cooperatives`. Don't add UTM tags on Hacker News, where they look spammy.
