# Provenance note for the enterprise modules (LICENSE-EE, ANNEX A)

This note records what is **established** about the provenance of the paths in
ANNEX A of `LICENSE-EE`, what is **not** established, and what would settle it.
It exists because ANNEX C deliberately no longer asserts that those files are
independently authored.

> Status: **open**. The evidence below measures text overlap. It does not, and
> cannot, establish authorship of material that was previously adapted from
> licensed code.
>
> Precise conclusion, so it is not read as more or less than it is: **sufficient
> evidence has not been recorded in this repository** to state the applicable
> license and the distribution basis of the affected files. This is *not* a
> finding that any file infringes, and *not* a finding that no authorization
> exists anywhere. Recording a maintainer's decision to merge would not itself
> supply that authorization.

## 1. What is established

- The Litefuse core outside ANNEX A is derived from the MIT-licensed Langfuse
  core and remains MIT (`/LICENSE`).
- Langfuse's commercial boundary is directory-based (`ee/`, `web/src/ee/`,
  `worker/src/ee/`). None of those directories exists in this repository. The
  ANNEX A paths implement the same feature areas, so the interfaces they must
  satisfy — route and hook signatures, database call shapes, provider
  identifiers, protocol-fixed values — are necessarily the same.
- Commit `5fb90ea` ("refactor: implement the enterprise modules independently of
  Langfuse's commercial edition") rewrote 32 files. Its own message states that
  material adapted from upstream commercial code was changed by altering wording,
  helper decomposition, control flow and naming.

## 2. What is NOT established

Reduced verbatim overlap is **not** evidence of independent authorship.
Re-wording, re-organising or renaming parts of a derivative work does not create
rights in the pre-existing material, and it does not remove the original
license from it. For several files the change is smaller than that: only a
user-visible response string was replaced, and the file is otherwise the same
implementation.

## 3. How the numbers below were produced

Method (same as the one used to review the rewrite; `MIN_LEN` is the only
parameter):

1. "Substantial line" = `line.trim()` of at least 40 characters that does not
   start with `import `, `//` or `*`.
2. Upstream commercial set = paths under `ee/`, `web/src/ee/`, `worker/src/ee/`
   in `langfuse/langfuse` at `main` = `0ea9fde` (v4.58.0).
3. A local line counts as shared only if it appears in the commercial set, in at
   most 4 of those files, and **not** anywhere in upstream's MIT core (the core
   exclusion keeps framework boilerplate from being counted).
4. Change classification is a heuristic over the commit diff: a file is
   `string-only` when every changed line pair differs only inside string
   literals. It separates "re-worded" from "restructured" and is not a legal
   classification.

Re-run with the scripts checked in beside this file:

```bash
# overlap of the current tree with upstream's commercial tree
node scripts/license/recheck-derivation.mjs <repo> <upstreamRoot> --leftovers
# regenerate the table in §4
node scripts/license/provenance-report.mjs <repo> <upstreamRoot> 5fb90ea
```

Verified against `langfuse/langfuse` at `main` = `0ea9fde`: the second command
reproduces §4 exactly (29 rows). `<upstreamRoot>` is a checkout of upstream at
that revision; the upstream revision is pinned here so the numbers stay
comparable.

## 4. Evidence

| file | residual shared lines | change | -/+ lines |
| --- | --- | --- | --- |
| `web/src/__tests__/server/memberships-api.servertest.ts` | 0 | string-only (1 string-only) | -1/+1 |
| `web/src/__tests__/server/organizations-api.servertest.ts` | 0 | string-only (1 string-only) | -1/+1 |
| `web/src/__tests__/server/projects-api.servertest.ts` | 0 | mixed (4 string-only) | -7/+11 |
| `web/src/components/BatchExportTableButton.tsx` | 0 | string-only (1 string-only) | -1/+1 |
| `web/src/components/SupportOrUpgradePage.tsx` | 0 | mixed (2 string-only) | -8/+8 |
| `web/src/features/audit-logs/AuditLogsSettingsPage.tsx` | 0 | structural | -10/+9 |
| `web/src/features/audit-logs/AuditLogsTable.tsx` | 0 | structural | -55/+77 |
| `web/src/features/audit-logs/OrgAuditLogsSettingsPage.tsx` | 0 | structural | -10/+9 |
| `web/src/features/billing/server/billingService.ts` | 0 | structural | -16/+37 |
| `web/src/features/enterprise/apiKeys/createProjectApiKey.ts` | 0 | structural | -20/+38 |
| `web/src/features/enterprise/apiKeys/deleteOrgApiKey.ts` | 0 | structural | -12/+18 |
| `web/src/features/enterprise/apiKeys/deleteProjectApiKey.ts` | 0 | structural | -11/+17 |
| `web/src/features/enterprise/memberships/deleteOrgMembership.ts` | 0 | string-only (1 string-only) | -1/+1 |
| `web/src/features/enterprise/memberships/deleteProjectMembership.ts` | 0 | string-only (1 string-only) | -1/+1 |
| `web/src/features/enterprise/memberships/listProjectMemberships.ts` | 0 | structural | -18/+15 |
| `web/src/features/enterprise/memberships/upsertProjectMembership.ts` | 0 | structural | -20/+20 |
| `web/src/features/enterprise/organizations/createOrganization.ts` | 0 | structural | -25/+58 |
| `web/src/features/enterprise/organizations/deleteOrganization.ts` | 0 | structural | -15/+25 |
| `web/src/features/enterprise/organizations/listOrganizations.ts` | 0 | structural | -5/+7 |
| `web/src/features/enterprise/organizations/updateOrganization.ts` | 0 | structural | -26/+61 |
| `web/src/features/enterprise/projects/createProject.ts` | 0 | structural | -53/+91 |
| `web/src/features/enterprise/projects/deleteProject.ts` | 0 | mixed (2 string-only) | -19/+19 |
| `web/src/features/enterprise/projects/updateProject.ts` | 0 | structural | -63/+103 |
| `web/src/features/enterprise/sso/createSsoConfig.ts` | 1 | structural | -23/+31 |
| `web/src/features/enterprise/sso/ssoConfigSchema.ts` | 0 | structural | -118/+85 |
| `web/src/features/enterprise/sso/ssoProviders.ts` | 0 | structural | -35/+39 |
| `web/src/server/adminApiAuth.ts` | 0 | structural | -62/+51 |
| `worker/src/features/billing/usageMetering.ts` | 0 | structural | -19/+21 |
| `worker/src/features/billing/usageThresholds.ts` | 1 | structural | -10/+14 |

string-only classification (needs provenance resolution, not a line count):
  - web/src/__tests__/server/memberships-api.servertest.ts
  - web/src/__tests__/server/organizations-api.servertest.ts
  - web/src/components/BatchExportTableButton.tsx
  - web/src/features/enterprise/memberships/deleteOrgMembership.ts
  - web/src/features/enterprise/memberships/deleteProjectMembership.ts

Reading of the table:

- **Residual shared lines** is at most 1 for every file, and the leftovers are
  framework idioms (a Prisma call shape, a `<Dialog open={open} …>` line, a
  generic 500 response). That is what the rewrite achieved.
- **Five files are `string-only`** — the change is a re-worded response, nothing
  else:
  - `web/src/components/BatchExportTableButton.tsx`
  - `web/src/features/enterprise/memberships/deleteOrgMembership.ts`
  - `web/src/features/enterprise/memberships/deleteProjectMembership.ts`
  - `web/src/__tests__/server/memberships-api.servertest.ts` (test assertion)
  - `web/src/__tests__/server/organizations-api.servertest.ts` (test assertion)
- The remaining files were changed structurally (helpers split, control flow
  reorganised, naming changed). A larger diff lowers measured overlap; it does not
  by itself answer the provenance question.
- Every file listed above was touched by `5fb90ea`, i.e. it belongs to the set
  that the commit message describes as adapted from the licensed code. The table
  therefore bounds the problem; it does not clear any file.

## 5. What would settle it

Either of the following, per file or for the set:

1. **Authorization** — a written license or permission from the Langfuse
   copyright holder (the upstream `ee/LICENSE` identifies the licensor; note that
   upstream's own terms have changed over time) covering these files and the
   distribution of the Software. Record the grant here and in ANNEX C.
2. **Documented independent implementation** — a clean-room process, recorded and
   auditable: derive the required behaviour from the interface and from tests,
   implement it without consulting the licensed source, and keep the record of
   that separation. Only this can support an independent-authorship statement.

Until one of those exists, the interim position is the one ANNEX C states: the
Langfuse Enterprise License continues to apply to any file that is a derivative
of the licensed material, and this repository's own license does not relicense
it.

## 6. Per-file applicable license and basis (required, currently incomplete)

`LICENSE-EE` scopes itself by ANNEX A and `LICENSE` preserves third party
components' own licenses, so "outside ANNEX A" alone does **not** mean MIT.
Each affected file therefore needs its own line: which upstream material it
corresponds to, which license that implicates, and what basis this repository
has for distributing it. Filling this table is what "settling provenance"
means in practice; moving a file into or out of ANNEX A does not.

Legend — **Basis**: `authorization` (recorded grant) · `clean-room` (recorded
independent implementation) · `upstream-MIT` (the file exists in upstream's MIT
core) · **`—` = not recorded**, which is the current state for most rows.

| File | Upstream correspondence (evidence) | Applicable license | Basis |
| --- | --- | --- | --- |
| `web/src/__tests__/server/memberships-api.servertest.ts` | upstream `web/src/__tests__/server/…` (MIT core, not `ee/`); `5fb90ea` only rewrote one expected response string | MIT | **upstream-MIT** |
| `web/src/__tests__/server/organizations-api.servertest.ts` | same (one assertion string) | MIT | **upstream-MIT** |
| `web/src/__tests__/server/projects-api.servertest.ts` | same (four assertion strings) | MIT | **upstream-MIT** |
| `web/src/components/BatchExportTableButton.tsx` | upstream `web/src/components/BatchExportTableButton.tsx` (MIT core, not `ee/`) | MIT | **upstream-MIT** |
| `web/src/components/SupportOrUpgradePage.tsx` | upstream has it **only** at `web/src/ee/features/billing/components/SupportOrUpgradePage.tsx` | Langfuse Enterprise | `—` (clean-room replacement written, see `docs/ee-independence/00-support-or-upgrade-page/`) |
| `web/src/features/audit-logs/AuditLogsTable.tsx` | upstream has it **only** at `web/src/ee/features/audit-log-viewer/AuditLogsTable/AuditLogsTable.tsx` | Langfuse Enterprise | `—` (clean-room replacement written, see `docs/ee-independence/01-audit-logs/`) |
| `web/src/features/audit-logs/AuditLogsSettingsPage.tsx` | upstream has it **only** at `web/src/ee/features/audit-log-viewer/AuditLogsSettingsPage.tsx` | Langfuse Enterprise | `—` (clean-room replacement written) |
| `web/src/features/audit-logs/OrgAuditLogsSettingsPage.tsx` | upstream has it **only** at `web/src/ee/features/audit-log-viewer/OrgAuditLogsSettingsPage.tsx` | Langfuse Enterprise | `—` (clean-room replacement written) |
| `web/src/server/adminApiAuth.ts` | upstream `web/src/ee/features/admin-api/server/adminApiAuth.ts` (12/15 distinctive identifiers shared) | Langfuse Enterprise | `—` |
| `web/src/features/enterprise/**` (admin-api CRUD family) | upstream `web/src/ee/features/admin-api/server/**` (identifier correspondence 5/7–8/14 per file) | Langfuse Enterprise (ANNEX A) | `—` |
| `web/src/features/enterprise/sso/{ssoProviders,createSsoConfig,ssoConfigSchema}.ts` | upstream `web/src/ee/features/multi-tenant-sso/**` (`ssoProviders.ts` shares 24/39 identifiers) | Langfuse Enterprise (ANNEX A) | `—` |
| `worker/src/features/billing/{usageMetering,usageThresholds}.ts` | upstream `worker/src/ee/cloudUsageMetering/…`, `worker/src/ee/usageThresholds/…` | Langfuse Enterprise | `—` |
| `web/src/features/billing/server/billingService.ts` | upstream `web/src/ee/features/billing/server/stripe/stripeWebhookHandler.ts` (21 shared identifiers) | Langfuse Enterprise | `—` |
| `web/src/features/public-api/server/scim*.ts`, `web/src/pages/api/public/scim/**` | no upstream counterpart found in `main` (upstream's SCIM work is not in the inspected revision); shared identifiers match unrelated features only | undetermined | `—` (developer process to confirm) |
| remaining `evaluators/workspace` and `web/src/pages/api/**` rows of §4 | no upstream file of the same name; individual origin not established | undetermined | `—` |

**How to read this table**: a `—` in the last column means the repository cannot
yet state a basis for distributing that file; it does not mean the file is
infringing or that no permission exists. The remedy for any row is one of
§5.1/§5.2 — record an authorization, or replace the file with a recorded
clean-room implementation (the path this repository is taking, tracked in
`docs/ee-independence/`), or remove it.

### 6.1 Recorded conclusion (wording per the reviewer's suggestion)

**The license declarations and provenance inventory do not clearly identify the
applicable license and distribution basis for each affected file.**

That is the finding, stated precisely: not that any listed file infringes, and not that
no authorization exists anywhere, but that the evidence needed to settle each file has
not been recorded in this repository. Two consequences follow and are recorded rather
than assumed away:

- Changing the ANNEX A path list is **not** a remedy. ANNEX A applies Litefuse's
  enterprise license; it does not grant rights in material governed by someone else's
  license, and rights in newly added material do not replace rights in preexisting
  material. A file that derives from upstream commercially licensed code needs a
  distribution basis (authorization, an independent rewrite, or removal) regardless of
  which list it appears in.
- A maintainer's decision to merge does not supply that basis either; it settles what
  this repository ships today, not what it is permitted to ship.

## 7. Where the detailed process records live

The per-batch evidence — the behaviour specification each implementer was given, the
implementation record (the implementer's declaration and the exact search commands it
ran), the similarity measurement, and the verification evidence — is **not** kept in this
repository: those files are process and provenance evidence rather than product content,
and they belong with the legal record rather than in every checkout of the application.

They are published, versioned, at
**https://github.com/fishysalt/litefuse-ee-independence-records** (this reference is
pinned to tag `v1`). The batch index there maps each record to the commit in this
repository that it documents, so a reader can move from a licence claim to the evidence
behind it and back.

Two notes about that repository:

- The similarity reports there are **redacted**: the single upstream source lines they
  originally quoted are replaced with a marker, because republishing those lines is a
  distribution of third-party licensed material that this project does not need to make.
  What is kept is the evidence that matters - file, line number, the number of shared
  lines, whether they form a block of two or more consecutive lines, and the reason a
  residual is acceptable. Unredacted reports are available to reviewers on request.
- Records are corrected by **appending** a dated section, never by editing an earlier one;
  where a decision was reversed (for example the SSO fail-closed change in batch 3a), both
  the original decision and its reversal remain visible.

Where a test file in this repository names a specification path under
`docs/ee-independence/...`, that path is the history of the file: the specification was
present in the tree when the tests were written and now lives in the records repository at
the batch directory of the same name.

## 8. Open loose ends (recorded, not resolved)

- **Git history.** Rewriting the current tree does not remove the earlier adapted code from
  this repository's history, nor from the published `license-ee` branch. Whether that
  history is kept (with a recorded basis) or rewritten is an open decision.
- **Per-file basis.** The `—` rows in section 6 are files whose applicable licence and
  distribution basis have not been recorded yet; most correspond to material not yet
  rewritten (batches 3a, 3b and 4) or to third-party components whose own licences apply.
