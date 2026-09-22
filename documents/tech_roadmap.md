# Cahootz Technical Roadmap

---

## Phase 1: Foundation

- Keep the web, API, mobile, database, and contract workspaces running from the monorepo.
- Standardize environment setup and local development docs.
- Replace legacy product language in public documentation.
- Keep the Cahootz charter as an empty placeholder until governance language is ready.

---

## Phase 2: Member and Co-op Basics

- Support co-op discovery, application, approval, and member profiles.
- Improve authentication and session flows across web and mobile.
- Keep co-op-specific settings configurable from admin screens.
- Expand public co-op pages with accurate business and product data.

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Implement middleware for theming based on co-op configuration � �
  - [ ] Conduct performance testing to ensure scalability with multiple co-ops � �
  - [ ] Add security measures to isolate data between co-ops � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Implement database schema changes to track proposal decisions � �
  - [ ] Add API endpoints for submitting and retrieving proposal decisions � �
  - [ ] Implement logging for proposal decision submissions to monitor usage � �

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Create a detailed deployment checklist for production releases � �
  - [ ] Set up monitoring alerts for critical services and endpoints � �
  - [ ] Implement logging for deployment events to track changes over time � �

---

## Keep co-op-specific settings configurable from admin screens. 🔴
*AI-suggested based on recent work: With the completion of co-op profiles, there is a need to ensure that settings can be easily managed and validated through the admin interface.*

  - [ ] Implement API endpoints for updating co-op settings
  - [ ] Add validation for co-op settings input
  - [ ] Create unit tests for the new API endpoints

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Implement backend logic to enforce thresholds and review windows � �
  - [ ] Create end-to-end tests for the admin controls � �

---

## Phase 3: Commerce

- Stabilize storefront, product, cart, checkout, and order flows.
- Improve merchant onboarding and payout setup.
- Add better payment status visibility and failure recovery.
- Strengthen transaction reconciliation and audit trails.

---

## Phase 4: Governance

- Keep proposal submission, comments, review, and voting usable without the disabled charter compliance gate.
- Make proposal scoring configurable by co-op.
- Add clearer admin controls for proposal categories, thresholds, and review windows.
- Track proposal decisions and funded milestones.

---

## Phase 5: Operations

- Improve treasury, rewards, member management, and store admin workflows.
- Add operational dashboards for health, payments, applications, proposals, and reconciliation.
- Document production deployment and incident response.
- Expand tests around high-risk financial and governance flows.

---

## Phase 6: Scale

- Prepare multi-co-op configuration, theming, and operational isolation.
- Harden event indexing and background jobs.
- Improve analytics, reporting, and export tools.
- Continue reducing legacy names in code after documentation migration is complete.

---
*🤖 Roadmap updated 2026-09-22 - AI-generated sub-items added based on completed work analysis*
