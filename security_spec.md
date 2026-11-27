# C-SYNC HRIS Security Specification

## 1. Data Invariants
1. **Authentication & Verification**: All read/write access requires `request.auth != null && request.auth.token.email_verified == true`.
2. **No Self-Assigned Privileges**: A user registering their own `users/{uid}` profile cannot self-assign `lead`, `hr_admin`, or `super_admin` unless they match the bootstrapped Super Admin email (`collabsync.hub@gmail.com`) or a Super-Admin-created `user_invites` document matching their verified email.
3. **Immutable Ownership & Timestamps**: Ownership fields (`userId`, `uid`, `recruiterId`, `senderId`) and `createdAt` cannot be altered after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
4. **Role Isolation**:
   - `employee`: Reads/writes only own `attendance`, `attendance_media`, `leave_requests`, `notifications`, and updates progress/status only on own assigned `tasks`. Zero access to `candidates`, `candidate_cvs`, `leave_policies` writes, or `settings` writes.
   - `lead`: Can read/approve `attendance` and `leave_requests` only for direct reports (`resource.data.managerId == request.auth.uid`), and create/manage `tasks` for direct reports.
   - `hr_admin`: Can read/approve all `attendance`, `leave_requests`, manage `leave_policies` (global & personal), and manage `candidates` + `candidate_cvs`. Cannot alter `settings` or user RBAC roles.
   - `super_admin`: Full administrative access across all collections, including `settings`, `users` role management, and `user_invites`.
5. **PII Protection**: `users` and `leave_requests` and `attendance` never permit blanket `allow list: if isSignedIn()`. Every `list` rule validates `resource.data` against ownership, `managerId`, or verified HR/Super Admin privilege.

## 2. Adversarial "Dirty Dozen" Payloads
1. **Self-Role Escalation**: Employee creates `users/{uid}` with `role: "super_admin"` -> DENIED.
2. **Profile Role Tampering**: Employee updates own `users/{uid}` changing `role` to `"hr_admin"` -> DENIED.
3. **Shadow Field Injection**: User submits `attendance` create with extra field `isBypassed: true` -> DENIED.
4. **ID Poisoning**: Write to `/attendance/<1500-char-id>` -> DENIED by `isValidId()`.
5. **Attendance Impersonation**: User A creates `attendance` with `userId: "userB"` -> DENIED.
6. **Cross-Team Lead Approval**: Lead A approves `leave_requests` belonging to Lead B's subordinate -> DENIED.
7. **Unverified Email Spoof**: Token with `email: "collabsync.hub@gmail.com"` and `email_verified: false` -> DENIED.
8. **Blanket User Scraping**: Employee executes `getDocs(collection(db, 'users'))` -> DENIED.
9. **Candidate PII Exfiltration**: Employee or Lead queries `candidates` or `candidate_cvs` -> DENIED.
10. **Settings Tampering**: HR Admin or Employee updates `settings/company` radiusMeters to `999999` -> DENIED.
11. **Timestamp Forgery**: Client creates `leave_requests` with backdated `createdAt` != `request.time` -> DENIED.
12. **Terminal State Bypass**: Employee updates already `approved` leave request to alter `totalDays` -> DENIED.
