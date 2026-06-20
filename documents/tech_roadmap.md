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
  - [ ] Integrate session validation checks during the onboarding process to ensure only authenticated users can onboard as merchants. � �
  - [ ] Implement error handling for session timeouts or invalid sessions during the onboarding process. � �
  - [ ] Create integration tests to verify that onboarding flows respect session states and handle errors gracefully. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Update deployment documentation to include steps for verifying session management and authentication flows post-deployment. � �
  - [ ] Add monitoring requirements for session-related metrics, such as session duration and failed authentication attempts. � �
  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Implement access control checks to ensure only authorized users can modify proposal settings based on their session roles. � �
  - [ ] Add logging for changes made to proposal settings to track who made changes and when. � �
  - [ ] Create tests to validate that only users with the correct permissions can access and modify proposal settings. � �

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

  <!-- 🤖 AI-generated sub-items based on completed work -->
  - [ ] Develop integration tests that simulate various session states (valid, expired, invalid) during financial transactions. � �
  - [ ] Implement security tests to ensure that session hijacking or replay attacks are mitigated in financial flows. � �
  - [ ] Add performance benchmarks to evaluate the impact of session management on transaction processing times. � �

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
*🤖 Roadmap updated 2026-06-20 - AI-generated sub-items added based on completed work analysis*
