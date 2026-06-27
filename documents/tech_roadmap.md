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
  - [ ] Implement session management for co-op members and ensure it integrates with the new member profiles. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Implement logging for co-op application submissions and approvals to monitor system health. � �
  - [ ] Create performance metrics for the new co-op discovery and application processes to identify bottlenecks. � �
  - [ ] Develop dashboard components that visualize the status of co-op applications and member profiles. � �

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

## Keep co-op-specific settings configurable from admin screens. 🟡
*AI-suggested based on recent work: As co-op profiles are now supported, it's essential to ensure that the admin interface can manage settings effectively, which requires new API integrations and testing.*

  - [ ] Implement validation and error handling for co-op settings updates to ensure data integrity.
  - [ ] Create integration tests for the admin interface to verify that settings changes propagate correctly to the co-op profiles.

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Create end-to-end tests for the co-op application and approval process to validate user flows. � �
  - [ ] Implement security tests to ensure that member data is protected during the application process. � �
  - [ ] Add performance tests to assess the impact of new member profiles on system load. � �

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
*🤖 Roadmap updated 2026-06-27 - AI-generated sub-items added based on completed work analysis*
