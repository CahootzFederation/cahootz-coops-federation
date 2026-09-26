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
  - [ ] Design the database schema changes needed for multi-co-op support. � �
  - [ ] Add security measures to isolate data between co-ops. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Conduct performance testing on the storefront and checkout processes to identify bottlenecks. � �
  - [ ] Implement logging for checkout and order processing to monitor transaction success and failures. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Define metrics and logging requirements for the operational dashboards. � �
  - [ ] Implement monitoring solutions to track the health of critical services. � �
  - [ ] Create visualizations for payment statuses and application processing times. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Create unit tests for the new co-op application and approval logic. � �
  - [ ] Add integration tests to validate the end-to-end flow of co-op discovery and application. � �

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

## Keep co-op-specific settings configurable from admin screens. 🟡
*AI-suggested based on recent work: With the recent improvements in member management workflows, it is crucial to ensure that co-op settings can be managed effectively to support the new features.*

  - [ ] Implement API endpoints to save and retrieve co-op-specific settings.
  - [ ] Add error handling for API calls related to settings configuration.

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Create UI components for managing proposal categories and thresholds in the admin panel. � �
  - [ ] Implement API endpoints to handle CRUD operations for proposal categories. � �
  - [ ] Add validation and error handling for proposal category management. � �
  - [ ] Write integration tests for the proposal category management functionality. � �

---
*🤖 Roadmap updated 2026-09-26 - AI-generated sub-items added based on completed work analysis*
