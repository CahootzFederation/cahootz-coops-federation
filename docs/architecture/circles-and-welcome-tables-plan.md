# Circles and Welcome Lounges: Single Product Plan

This is the source of truth for the Circles and Welcome Lounges work. It replaces
earlier sketches and resolves their inconsistencies.

## Product model

- A **Common** is the community container.
- A **Circle** is a room inside one Common. Circles do not replace Commons.
- The **Commons** tab remains named Commons. For signed-in members, tapping it
  opens the selected Common's circle explorer first, not the Common feed.
- The original Common feed remains available from a **Commons feed** tile in
  that explorer.
- A circle's existing feed design stays intact. The only circle-feed additions
  are temporary presence handling and a **Leave chat** control.

## Circle explorer

The explorer is the first screen reached from:

- the signed-in Commons tab;
- selecting a Common in the drawer; and
- the onboarding **Explore on my own** choice.

It shows:

- one Commons feed tile;
- public circles in the selected Common; and
- private or invite-only circles the member belongs to, including their
  welcome lounge.

Circle tiles use deterministic solid-color circular backgrounds rather than
member photos. Each tile shows the circle name and aggregate activity beneath
it: `N chatting`, `No one chatting`, or `Public · Join`. It never exposes the
names or faces of people currently chatting.

Opening a public circle joins the member first. Opening a private circle is
only possible for its members. Welcome lounges are never discoverable or
joinable through the explorer, a public join, or an invite code.

## Membership and temporary chat presence

Membership and chatting are independent states.

| Action | Membership | Chatting presence |
| --- | --- | --- |
| Open a circle feed | unchanged | starts or refreshes |
| Remain in the feed / type / heartbeat | unchanged | refreshes |
| Leave chat | unchanged | immediately ends |
| Leave circle | permanently ends | immediately ends |

Presence expires after 90 seconds without activity as a safety net. The
explorer refreshes activity periodically. Circle membership continues to power
private-circle access; presence only powers the aggregate `chatting` count.

## Onboarding

After the member completes or defers their profile, onboarding shows one final
choice:

1. **Explore on my own**: open the Cahootz circle explorer.
2. **Join a welcome lounge**: securely assign the member to a private welcome
   table under `coopId = cahootz`, then open that circle's normal feed.

The action is idempotent. A member who already has a welcome-table membership
returns to that same table rather than receiving another one.

## Welcome lounges

Welcome lounges are system-managed private Circles in the Cahootz Common.

- Names use the fixed convention `Welcome Lounge {number}`.
- Numbers never recycle. `WelcomeTableConfig.lastTableNumber` is the
  authoritative stored counter.
- The default capacity is 30 newcomers; the guide does not use a newcomer
  seat.
- Each table has one configured Cahootz guide, recorded as `GUIDE`; newcomers
  are recorded as `NEWCOMER`.
- The default rotation period is two months and is configurable by an admin.
- Rotation is **lazy and transactional**: when a newcomer requests a table,
  the backend checks the active table's age and capacity. If it is expired or
  full, it closes that table as appropriate and creates the next number before
  assigning the newcomer. No separate cron job is required.
- An administrator can use **Start next welcome lounge** to close the current
  open table and immediately create the next number. Existing members remain
  in the earlier table.

Welcome-table privacy, invite codes, and guide membership are not member
managed. A newcomer may formally leave their table; a guide is managed by the
admin configuration.

## Backend and administration

The backend owns all allocation decisions. The client only requests an
assignment; it cannot pick a table number, guide, or capacity.

The persisted configuration includes:

- `enabled`
- `capacity`
- `rotationMonths`
- `guideUserId`
- `lastTableNumber`
- `activeTableId`

Allocation and manual increments run in serializable transactions and lock the
configuration row. This prevents two concurrent onboarding requests from
creating the same table number or overfilling a table.

The Cahootz platform-admin page provides the configuration controls, recent
table history, and the manual next-table action. Every assignment, creation,
configuration change, and manual increment is audited.

## Acceptance criteria

- Tapping **Commons** as a signed-in member opens the circle explorer.
- The existing feed can still be reached through the Commons feed tile.
- Public and member-private circles are correctly scoped to the selected
  Common.
- Counts show only aggregate temporary chat activity, never identities.
- Leaving chat does not remove membership; leaving a circle does.
- Welcome lounges are private Cahootz-only circles, assigned only through
  onboarding.
- Table numbering remains sequential across capacity-based, time-based, and
  manually started rotations.
- Admin controls validate guides and configuration values.
- The migration is applied before deploying; mobile type checks, backend unit
  tests, and the two-user Playwright journey must pass in an environment with
  running API, mobile, and database services.
