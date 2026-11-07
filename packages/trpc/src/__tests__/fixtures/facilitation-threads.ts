import type { ThreadSnapshot } from "../../services/sage-facilitation.js";

/**
 * Commons and circle threads for the facilitation tests, written in members' own register: short,
 * informal, sometimes off topic. The Sage comments are Sage's real replies from the shared-drivers and
 * potluck journeys' CI runs. (No local database has real multi-member threads to copy, and production
 * data isn't used in tests.)
 */

export const NOW = new Date("2026-10-16T18:00:00.000Z");
const MIN = 60_000;
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MIN);

function thread(postAuthorId: string, title: string, content: string, comments: Array<[string, string, number]>, postedMinutesAgo = 600): ThreadSnapshot {
  return {
    postId: "post-1", postAuthorId, title, content, createdAt: at(postedMinutesAgo),
    comments: comments.map(([authorId, text, minutesAgo], index) => ({
      id: `c${index + 1}`, authorId, isSage: authorId === "sage", content: text, createdAt: at(minutesAgo),
    })),
  };
}

/** A factual question two people shrug at, then the thread moves on. */
export const UNANSWERED_QUESTION = thread("maya", "Potluck spot", "Thinking the library community room for the October potluck. Does anyone know what time the library closes on Saturdays?", [
  ["dev", "not sure tbh, I think it changed over the summer", 300],
  ["rosa", "I can bring the big rice cooker either way", 240],
  ["maya", "ok but does anyone know if they let you bring hot food in?", 200],
  ["tasha", "No idea! I've only been for story time", 120],
]);

/** The same question, answered after the shrug. */
export const ANSWERED_QUESTION = thread("maya", "Potluck spot", "Does anyone know what time the library closes on Saturdays?", [
  ["dev", "not sure, I think it changed", 300],
  ["rosa", "It closes at 5 on Saturdays, I was there last week", 240],
]);

/** Members pushing back on each other over two options. */
export const DISAGREEMENT = thread("maya", "Monthly potluck", "Should we keep doing the potluck at the library or rotate between homes?", [
  ["dev", "Library is free and on the bus line, I'd rather keep it there", 300],
  ["rosa", "I don't think the library works, it closes at 7 and we always get kicked out mid-dessert", 260],
  ["dev", "but what about people without cars? homes are spread all over", 200],
  ["tasha", "Homes are nicer but the same two people end up hosting every time", 150],
]);

/** Agreement on shared spending, with numbers: ready to become a proposal draft. */
export const READY_FOR_PROPOSAL = thread("andre", "Shared delivery van", "Three of us pay separately for delivery drivers. What if we lease one van together? Leasing is about $450 a month.", [
  ["kim", "I'm in, I pay $300 a month right now just for Tuesday drops", 400],
  ["luis", "Count me in. We could split the cost three ways", 350],
  ["kim", "Mondays and Thursdays work for me", 300],
  ["bree", "Sounds good, I'd chip in too if it covers the north side", 100],
]);

/** Two people settle something for everyone in a longer thread nobody else joined. */
export const NARROW_DECISION = thread("andre", "Pickup time change", "Can we move Saturday market pickup from 3 to 3:30? I keep running late from my shift.", [
  ["kim", "3:30 is fine by me", 400],
  ["andre", "cool, any objections?", 380],
  ["kim", "doesn't look like it", 200],
  ["andre", "Ok let's go with 3:30 starting next week", 30],
]);

/** A long, friendly thread that circles without landing. */
export const BUSY_THREAD = thread("maya", "Garden workday", "We should do a workday at the community garden before frost. Who's around?", [
  ["dev", "I'm around most weekends", 590],
  ["rosa", "weekends are hard for me but evenings work", 560],
  ["tasha", "evenings it gets dark so early now", 520],
  ["dev", "maybe a Sunday morning?", 480],
  ["luis", "Sunday mornings I have church", 440],
  ["rosa", "what about a weekday evening with lights?", 400],
  ["tasha", "the garden doesn't have lights though", 360],
  ["maya", "we could borrow the work lights from the hardware co-op", 300],
]);

/** Someone puts it off. */
export const DEFERRAL = thread("maya", "Tool library hours", "Should the tool library open Thursday evenings too?", [
  ["dev", "Maybe, depends who can staff it", 200],
  ["rosa", "Let's revisit this next week once we know the volunteer schedule", 5],
]);

/** Sage replied two hours ago; members kept going. */
export const SAGE_SPOKE_RECENTLY = thread("andre", "Shared drivers", "Could a few businesses share delivery drivers instead of each paying our own?", [
  ["kim", "I'd be into that", 400],
  ["sage", "Shared delivery drivers could help us keep this work inside the Commons. Here's what we can do:\n• Share your delivery days, rough weekly stops, and current costs.\n\nOnce you've done that, I can draft a concrete proposal for members to review.", 120],
  ["luis", "I'm not sure that works for us, our routes are all over", 100],
  ["kim", "I'd rather keep it to the downtown stops then", 90],
  ["bree", "On the other hand the north side is where we lose the most time", 60],
]);

/** Small talk: nothing for Sage to do. */
export const QUIET = thread("maya", "Thank you!", "Thanks everyone who came out Saturday, that was so fun", [
  ["dev", "So fun!! Rosa's tamales 🔥", 100],
  ["rosa", "haha thank you, next time I'll bring more", 60],
]);
