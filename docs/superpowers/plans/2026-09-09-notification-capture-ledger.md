# SDD ledger — plan: docs/superpowers/plans/2026-09-09-notification-capture.md

Spec: docs/superpowers/specs/2026-09-09-notification-capture-design.md (read, binding authority)
Branch: notification-capture. Start commit: 24eeae95b3d22f3a527c7780515112c7d2ef229c

Ruling: work in the primary checkout on branch `notification-capture`, not a git
worktree — a worktree needs its own `npm install` (Expo/React Native native deps,
plus iOS pods), and this is a single sequential feature with no parallel branch.
Cost if wrong: nothing is isolated from the working tree, so an abandoned run
needs `git reset` rather than deleting a directory.

## Preflight scan

### Cross-task pairs sharing a file or an interface

| Producer | Consumer | Produced vs consumed | Finding |
|---|---|---|---|
| T1 types.ts | T4 mappers.ts | `Transaction.provisional`, `.supersededById` | OK — T4 supplies both in `toTransaction` |
| T1 dedupe.ts | T2 types.ts | `fnv1aHash` | OK — exported through core/index.ts; importers depends on @finant/core |
| T1 provisional.ts | T5 reconcile.ts | `matchProvisionals`, `PROVISIONAL_DAY_WINDOW` | OK — merged into one import line (fixed pre-flight) |
| T1 provisional.ts | T10 use-capture-inbox | `staleProvisionals`, `PROVISIONAL_STALE_DAYS` | OK |
| T2 notifications/types | T4 mappers.ts | `ParsedMovement` | OK — apps/mobile depends on @finant/importers |
| T3 notification-routing | T4 mappers.ts | `NotificationRoute`, `RuleMatch` | OK |
| T3 notification-routing | T7 capture-service | `resolveRoute` | OK |
| T4 transactions-repo | T5 ingest.ts | `NewTransaction.provisional` | OK — T5 sets it from options |
| T4 repos | T7/T9/T10 | capture + source repos | OK |
| T5 ingest.ts | T7 capture-service | `ingest(drafts, {provisional})` | OK — options param optional, existing import.tsx call unaffected |
| T6 module index | T7 headless-task | `CAPTURE_TASK_KEY` | OK — constant duplicated as a Kotlin literal; T6 comments say they must match |
| T8 i18n | T9/T10 screens | `notifications.*` keys | OK — T8 precedes both |
| T9 settings screen | T10 dashboard | different files | No overlap |

### Per-task self-consistency

| Task | Tests vs code, files vs later touches | Finding |
|---|---|---|
| T1 | 16 tests against exact-amount matcher | OK after the exact-amount edit; "consumes at most once" and ambiguity tests both hold under date-only ordering; `dedupe.test.ts` is a new file, no collision in packages/core/tests |
| T2 | registry + hash + calendar-day tests | OK — `captureHashOf` excludes `bookingDate`, which the stability test relies on |
| T3 | route tests | OK — tie-break test relies on lower id winning, which `best()` does |
| T4 | migration 9 vs repo columns | OK — `booking_date` present in both (spec was missing it; corrected in 24eeae9) |
| T5 | reconcile imports | Two `@finant/core` import lines — FIXED pre-flight |
| T6 | Kotlin vs manifest vs config | OK — service is fully qualified in the manifest |
| T7 | capture-service imports | **CONFLICT** — see ruling below |
| T8-T12 | prose steps | OK — no exact values to contradict |

### Rulings from the scan

Ruling: T7's `capture-service.ts` imports `type DraftTransaction` from
`@finant/core`, but `DraftTransaction` is declared in
`packages/importers/src/profile.ts` and exported from `@finant/importers`. The
import must come from `@finant/importers`. Spec names no module for it, so the
code is the authority. Cost if wrong: nothing — it would not compile otherwise.

Ruling: T7's `draftFrom` builds `amount` as an object literal with a plan note
offering `money()` instead. Use `money(movement.amountMinor, movement.currency)`
from `@finant/core`. Every other producer of a `Money` in this codebase goes
through `money()`, and consistency at a boundary that carries amounts is worth
more than saving an import. Cost if wrong: none — `money()` returns the same
shape.

Ruling: `expo-modules-core` stays undeclared in `apps/mobile/package.json`.
It is hoisted (57.0.14) and every Expo module imports it as an implicit peer,
which is how the rest of this app already works. Cost if wrong: a future
hoisting change breaks the import, and the fix is one dependency line.

Ruling: T12's final step says merge into `main`. Merging is a side effect this
skill requires asking about, so the merge will be presented as an option by
finishing-a-development-branch rather than performed. Cost if wrong: none.

## Progress

Task 1: dispatched (sonnet), BASE 24eeae9
Task 1: implementer DONE — commit 85e981a, 511 tests pass, typecheck fails only in apps/mobile/src/db/mappers.ts (expected, Task 4)
Task 1: Ruling: the plan's Step 13 says "16 tests" but its own Step 9 test file has 15 `it()` blocks — my edit swapped one test for another without changing the count and I miscounted. 15 is correct; the plan text is the defect. Cost if wrong: none, a count in prose.
Task 1: Ruling: packages/assistant/tests/factory.ts was outside the brief's file list but constructs a Transaction and broke under the widened type. Including the same two-field default in this commit is correct — the alternative is a knowingly broken typecheck in a second package. Cost if wrong: a two-line change to revert.
Task 1: task reviewer dispatched (sonnet), diff 24eeae9..85e981a
Task 1: review — spec ✅, quality Approved, 1 Important (missing regression test for ambiguous-then-consumed; code confirmed correct), 1 Minor deferred, 1 ⚠️ resolved below
Task 1: minor (deferred): single-pass greedy never backtracks, so a booked row whose candidates tied stays unmatched even after the rival provisional is consumed elsewhere. Conservative, never a wrong guess, inherent to the specified algorithm. Surface to the final review and to whoever builds the inbox UI — a "leftover ambiguous" provisional may be resolvable on a second pass.
Task 1: Ruling: the ⚠️ — widening `TransactionSource` also lets `Account.provider` hold 'notification'. Left as is. The spec states accounts keep `provider = 'file-import'` because an account still gets its truth from statements, nothing in this feature writes an account provider, and splitting the union into two types to enforce it is a refactor of every account read for a value no behaviour consults. Cost if wrong: an account could be created carrying a meaningless provider; the fix is a narrowed type on one field.
Task 1: fix round 1/5 dispatched (resumed implementer) — 1 finding
Task 1: fix round 1/5 (1 addressed, 0 open; commits 85e981a..c8f2f0c)
Task 1: complete (commits 24eeae9..c8f2f0c, review clean)
Task 2: dispatched (haiku — brief carries complete code, transcription plus tests), BASE c8f2f0c
Task 2: implementer DONE — commit 5b534c1, 12 notification tests, 524 full suite
Task 2: task reviewer dispatched (sonnet), diff c8f2f0c..5b534c1
Task 2: review — spec ✅, quality Needs fixes, 1 Important (plan-mandated), 2 Minor
Task 2: Ruling: the Important finding is real and mine — `captureHashOf` joined fields with an unescaped '|', so title "A"/body "B|C" and title "A|B"/body "C" hash identically. A deterministic collision in a dedupe key silently drops one of two real notifications, and bank text is not under our control. Fixed by length-prefixing each field, plus a regression test. Plan text corrected too, so a later reader cannot reintroduce it. Cost if wrong: none — capture_hash has no stored values yet.
Task 2: Ruling: `importHashOf` in packages/core/src/dedupe.ts has the same unescaped-join shape and is NOT being fixed. Its output is frozen — those hashes are stored as transactions.import_hash in every existing database, and changing them would re-import the owner's whole history as new rows. Cost if wrong: a statement whose description contains '|' at just the wrong offset could collide with another row on the same account, date and amount. Vanishingly unlikely, and the remedy would be a migration that rehashes every row, which is its own risk. Flagged to the final review.
Task 2: minor (deferred): a null title and an empty-string title hash identically in captureHashOf. Both mean "no title"; note only if Android turns out to emit "" distinctly from absent.
Task 2: fix round 1/5 dispatched (resumed implementer) — 1 Important + 1 doc-comment minor
Task 2: fix round 1/5 (2 addressed, 0 open; commits 5b534c1..067fa98)
Task 2: complete (commits c8f2f0c..067fa98, review clean)
Task 3: dispatched (haiku — brief carries complete code), BASE 067fa98
Task 3: implementer DONE — commit 24eb98c, 8 new tests, 533 full suite
Task 2: REOPENED. Ruling: Task 2's completion was premature — it left `npm run typecheck` red at packages/importers/tests/notifications.test.ts:83 (TS2353, a full CapturedNotification literal spread into captureHashOf's narrower parameter type), and its report claimed the failure was confined to apps/mobile/src/db/mappers.ts. vitest passed because esbuild strips types without checking them, so a green suite is not evidence of a green typecheck. Defect originates in my plan text; plan corrected. Fix round 2/5 dispatched to the Task 2 implementer. Cost if wrong: none, it is a one-line test change that preserves the assertion's intent.
Task 2: process ruling: every implementer dispatch from here on must paste the tail of `npm run typecheck` into its report as evidence, rather than asserting the state. Task 2's inaccurate claim survived a full task review because reviewers are instructed not to re-run suites. Cost if wrong: a few lines of report noise per task.
Task 3: task reviewer dispatched (sonnet), diff 067fa98..24eb98c
Task 2: fix round 2/5 (1 addressed, 0 open; commits 24eb98c..29d5a01) — typecheck independently confirmed by controller: only apps/mobile/src/db/mappers.ts errors
Task 2: complete (commits c8f2f0c..29d5a01, review clean)
Task 3: review — spec ✅, quality Approved, 1 Important (missing priority-inversion test; code verified correct by hand), 2 Minor, 1 ⚠️
Task 3: Ruling: the ⚠️ — a route rule authored against MatchField 'counterparty' or 'reference' can never match, because resolveRoute passes both as null and targetOf normalises them to ''. Not a defect: a notification has one text field. Task 9's route sheet builds `{ kind: 'word', field: 'any', value }` with no field picker, so the trap is unreachable from the UI. Carried into the Task 9 dispatch as a constraint: the route editor must never offer a field choice. Plus a doc note on NotificationRoute.match in this fix round. Cost if wrong: a route the owner authors silently never matches and everything lands on the fallback, which the inbox already flags as viaFallback.
Task 3: minor (deferred): best() duplicates the "highest priority, ties to lower id" fold already inline in categorise(). A shared helper would DRY it; the brief specified this code verbatim and the duplication is 12 lines of pure selection logic.
Task 3: fix round 1/5 dispatched (resumed implementer) — 1 Important + 1 doc note
Task 3: fix round 1/5 (2 addressed, 0 open; commits 29d5a01..d79884c)
Task 3: complete (commits 067fa98..d79884c, review clean)
Task 4: dispatched (sonnet — migration + 3 repos + mappers, integration concerns), BASE d79884c
Task 4: implementer DONE — commit b700018, 534 insertions across schema/mappers/3 repos
Task 4: controller-verified independently: `npm run typecheck` leaves exactly one error (apps/mobile/src/services/ingest.ts:38, Task 5's); the modified INSERT OR IGNORE counts 19 columns / 19 placeholders / 19 bound values, aligned by position (counted by hand in the working tree, not taken from the report)
Task 4: Ruling: the brief's "Produces" list named `redactCaptureText(id)` while its Step 5 code provides `repointCapture`. Step 5's code is right and the summary list was stale — `setCaptureStatus` already NULLs title, body and parsed_json in the same UPDATE, so a separate redaction function would be dead code. Plan's Produces line corrected. Cost if wrong: none, no caller wanted it.
Task 4: note: apps/mobile/src/db/database.ts and src/i18n/index.ts carry pre-existing uncommitted changes from before this plan started; the implementer correctly left them out of its commit. They still need their own commit on main eventually.
Task 4: task reviewer dispatched (sonnet), diff d79884c..b700018
Task 4: review — spec ✅, quality Approved, no Critical/Important, 2 Minor
Task 4: minor (deferred): updateNotificationSource issues up to three separate UPDATEs (one per patched field) instead of one statement or a withTransactionAsync wrapper. Not a correctness bug; a crash between statements leaves a partially-applied patch to a settings row.
Task 4: minor (deferred): getCapture is exported but not yet consumed — Task 7's acceptCapture consumes it. Confirm in Task 7's review that it is not dead code.
Task 4: complete (commits d79884c..b700018, review clean)
Task 5: dispatched (sonnet — wires reconciliation into the ingest path), BASE b700018
Task 5: implementer DONE — commit 7012d8d; typecheck controller-verified fully green (exit 0) for the first time on this branch; 534 tests pass; ingest ordering and the transfers filter verified by reading the working tree
Task 5: task reviewer dispatched (sonnet), diff b700018..7012d8d
Task 5: review — spec ✅, quality Needs fixes, 1 Important (plan-mandated), 2 doc Minor
Task 5: Ruling: the Important finding is real and mine. supersedeProvisionals committed, then repointCapture ran in an uncommitted loop; a throw midway left captures pointing at soft-deleted movements with no retry path, because the next reconcile only reads live provisionals. Fixed two ways: the capture repoint moves inside supersedeProvisionals' existing transaction (one fact, one commit), and the reconcile call in ingest is wrapped so a failure cannot fail an import whose rows are already inserted — the provisionals stay live and the next import retries. repointCapture is deleted rather than left dead. Cost if wrong: a transactions repo now writes notification_captures, which blurs a repo boundary; the alternative was a permanently broken audit trail.
Task 5: Ruling: the catch in ingest swallows silently and reports superseded: 0. Logging is not an option — the only thing to log is a movement's own details, which this project forbids. Reporting 0 honestly plus a retry on the next import beats both a false failure banner and a logged narrative. Cost if wrong: a persistent reconciliation fault would be invisible except as provisionals that never clear, which the stale check surfaces after 45 days.
Task 5: plan text corrected for both.
Task 5: fix round 1/5 dispatched (resumed implementer) — 1 Important + 2 doc minors
Task 5: fix round 1/5 (3 addressed, 0 open; commits 7012d8d..eaf91ac)
Task 5: minor (deferred): the capture repoint in supersedeProvisionals fires unconditionally per pair, even if that pair's supersede UPDATE matched zero rows. Unreachable on the current single-writer path (reconcileProvisionals reads provisionals fresh immediately before matching, and matchProvisionals pairs each at most once), and carried forward from the pre-fix loop rather than introduced. A `result.changes > 0` guard would close it. Point the final review at this.
Task 5: complete (commits b700018..eaf91ac, review clean)
Task 5: controller-verified: no stray compiled .js anywhere in packages/ or apps/ and none committed on this branch — the implementer generated 76 during its session and cleaned them up. This repo is specifically vulnerable: relative imports are extensionless and Metro would resolve ./money to a stale money.js over money.ts.
Ruling (environment): this Mac has the Android SDK (platform 36) and adb, but NO Java runtime, so Gradle cannot run and the Kotlin in Task 6 cannot be compiled here. Installing a JDK is a change to the owner's machine, so I am not doing it unilaterally — the owner has been told to run `brew install --cask zulu@17`. Tasks 6-10 proceed as code plus `npx expo prebuild` and typecheck verification; Kotlin compilation and every device step (Task 9 step 5, Task 10 step 8, all of Task 12 step 5) are deferred until the JDK exists. Cost if wrong: the Kotlin ships unread by a compiler, so a syntax or API error surfaces at the owner's first build rather than now.
Task 6: dispatched (sonnet — native module, scaffolding plus Kotlin), BASE eaf91ac
Task 6: implementer DONE — commit edc51b1, 9 module files, prebuild succeeded, autolinking discovers the module, typecheck green
Task 6: Ruling: the implementer was right and my brief was wrong — `expo prebuild` does not produce a merged AndroidManifest; AGP merges library manifests at Gradle time. The plan's claim that no config plugin is needed still holds (the service is declared in the module's own android/src/main/AndroidManifest.xml, and AGP merges it), but it is now an unproven assumption on this machine rather than something verified. First thing to check after the JDK lands.
Task 6: Ruling: found an Important defect myself by reading the Gradle sources — the module declared no React Native dependency, and the Kotlin cannot resolve any com.facebook.react.* import. expo-module-gradle-plugin adds only kotlin-stdlib, annotations and expo-modules-core (ProjectConfiguration.kt:53-65), and expo-modules-core declares react-android as `implementation` rather than `api` (android/build.gradle:223) so it is not transitive. androidx.core IS transitive (declared `api` at line 215), so NotificationManagerCompat was never at risk. Fix: `implementation 'com.facebook.react:react-android'`, unversioned, mirroring expo-modules-core's own declaration. Plan gains a Step 8b so it cannot be lost. Cost if wrong: a Gradle resolution error at the owner's first build, with the fix already written down.
Task 6: fix round 1/5 dispatched (resumed implementer) — 1 Important
Task 6: review (opus) — spec ✅, quality Approved, 1 Important, 5 Minor. Reviewer hand-checked every Kotlin signature against node_modules, ran swiftc -typecheck on the Swift stub (exit 0), and confirmed both Android and Apple autolinking resolve the module. It also confirmed the unversioned react-android line resolves, via DependencyUtils.kt:130-152 forcing the version across all subprojects.
Task 6: Ruling: the Important finding is real and mine. HeadlessJsTaskService.acquireWakeLockNow takes an untimed PARTIAL_WAKE_LOCK stored in RN's own private companion field, released only by HeadlessJsTaskService.onDestroy — which this app never runs, since the class extends NotificationListenerService. First notification would pin the CPU awake permanently. Replaced with our own lock acquired with the task timeout so it self-releases. Keeping a lock at all is deliberate: without one the device can suspend before the headless task's database write completes and the capture is lost. Plan corrected. Cost if wrong: a 15s partial wake lock per bank notification, which is negligible and cannot leak.
Task 6: also fixing three minors in the same round: try/catch containing the JS handoff (a throw there crashes the app rather than dropping one capture), synchronized on the learning-mode prefs read-modify-writes (learn runs on the listener thread, consumeLearned on the Expo function thread), and a podspec claiming an author of '' and a GitHub homepage that does not exist.
Task 6: accepted as-is, deliberate: reactHost == null silently drops a capture (new arch is on; the alternative is worse), and the iOS stub returns false/[] rather than throwing for isPermissionGranted/consumeLearnedPackages so a screen reading grant state does not blow up.
Task 6: CARRY TO TASK 7: RN's AppRegistryImpl calls console.error(reason) when a headless task handler rejects with a plain Error. The JS task must never put notification text into a thrown error message. Task 7's brief already swallows errors silently, which satisfies this.
Task 6: CARRY TO TASK 7: the reviewer confirmed nothing registers the 'FinAntNotificationCapture' task yet, so until Task 7 lands, a capture would log "No task registered for key" and finish. Expected.
Task 6: fix round 2/5 dispatched (resumed implementer) — 1 Important + 3 Minor
Task 6: fix round 2/5 (4 addressed, 0 open; commits abeab05..ab8c5be)
Task 6: Ruling: the re-review's out-of-scope observation is load-bearing, so it enters the loop rather than the deferred list — WAKE_LOCK is declared nowhere, and PowerManager.newWakeLock().acquire() throws SecurityException without it. The feature would fail at the first notification. Predates the fix (the brief's original acquireWakeLockNow needed it too). Declared in the module's own manifest so it travels with the module. Plan corrected. Cost if wrong: none, it is a normal permission with no prompt.
Task 6: Ruling: the re-review's own new Minor is also load-bearing and enters the loop — the try/catch covers only the warm path. On the cold path (app closed when the notification arrives, which is the case this feature exists for) the work runs inside onReactContextInitialized, invoked later by the framework outside the enclosing try, so a throw there still crashes the app. Fixed with its own try/catch plus a finally for removeReactInstanceEventListener, since a listener left registered would start a duplicate task on the next context init. Cost if wrong: a crash on the path that matters most.
Task 6: fix round 3/5 dispatched (resumed implementer) — 2 Important
Task 6: fix round 3/5 (2 addressed, 0 open; commits ab8c5be..aaa77b2)
Task 6: complete (commits eaf91ac..aaa77b2, review clean after 3 rounds)
Task 6: minor (deferred): reactHost == null silently drops a capture. Harmless while newArchEnabled=true (verified in android/gradle.properties), but if the new architecture were ever turned off every capture would vanish with no signal.
Task 6: NOT COMPILER-VERIFIED. No JDK on this machine, so none of the Kotlin or Swift has been compiled and no manifest merge has run. The reviewer hand-checked every signature against node_modules and type-checked the Swift with swiftc, but the first real Gradle build is still the first compile. Point the final review at this.
Task 7: dispatched (sonnet — headless task, entry repoint, capture service), BASE aaa77b2
Task 7: implementer DONE — commit 4d139e8; controller-verified: typecheck 0 errors, 534 tests, `expo export --platform ios` bundles the new entry (1949 modules), index.js imports expo-router/entry first, "main" repointed, no console.* under src/notifications
Task 7: review — spec ❌ on one point, quality Needs fixes, 1 Important (plan-mandated), 2 doc Minor. All six flagged device-risk paths verified correct: status mapping, duplicate early return before auto-approve, auto-approve gated on kind === 'movement', acceptCapture leaving a route miss pending rather than accepted, capture hash as importHash discriminator, and getTimezoneOffset() taken for the notification's own instant so DST is handled.
Task 7: Ruling: the Important finding is real and mine. An `ignored` verdict inserted directly with status 'dismissed' while keeping title and body, bypassing setCaptureStatus and its nulling UPDATE — so a bank's marketing push would keep its narrative in the encrypted DB forever, against migration 9's own stated contract that a settled capture forgets its text. Fixed at the insert: text is nulled for `ignored`, kept for `pending` (about to be read) and `unreadable` (it is the bug report). Plan corrected. Cost if wrong: none; nobody reviews an ignored capture.
Task 7: fix round 1/5 dispatched (resumed implementer) — 1 Important + 2 doc minors
Task 7: fix round 1/5 (3 addressed, 0 open; commits 4d139e8..39c9984)
Task 7: complete (commits aaa77b2..39c9984, review clean)
Task 8: dispatched (sonnet — i18n in three languages, translation judgement), BASE 39c9984
Task 8: review — spec ✅, quality Approved, no Critical/Important, 1 Minor. Reviewer read all 38 keys in three languages: placement and ordering identical, all four placeholders intact, autoApproveHint's off/on mapping not inverted in either language, terminology (Kontoauszug/extracto, Umsatz/movimiento, Konto/cuenta) reused from existing copy, register informal throughout in both.
Task 8: minor (deferred): de `learning` uses a terse third-person status fragment ("Hört {{seconds}} s zu") rather than a continuous form. Consistent with other status strings in the file.
Task 8: complete (commits 39c9984..ef6ab8e, review clean)
Task 9: dispatched (sonnet — settings screen, prose brief), BASE ef6ab8e
Task 9: implementer DONE — commit 02d3f11; controller-verified: field:'any' is the only match construction, syncAllowedPackages covers both allowlist-changing paths (no enabled toggle exists in the UI), typecheck 0, 534 tests, expo export bundles
Task 9: review — spec ❌, quality Needs fixes, 4 Important + 1 promoted ⚠️, 5 Minor
Task 9: Ruling: promoted the reviewer's ⚠️ to a fix. useFocusEffect fires on navigation focus, not OS foreground, so returning from the Android Settings app after granting access would leave the permission card showing "not granted" — the exact state section 2 exists to display. Adding an AppState 'change' listener that reloads on 'active', keeping the focus effect too since they cover different transitions. Cost if wrong: an extra reload on every foreground, which is two cheap queries.
Task 9: Ruling: AccountPicker gets an `allowCreate?: boolean` prop defaulting to true, and this screen passes false. Hiding the creation affordance beats disabling it: tapping "new bank" today opens a name field and permanently disables Save with no explanation, which invites the owner to type into a dead end. Creation here would contradict the screen's own "never create an account" rule. Cost if wrong: one optional prop on a shared component, default preserves the import screen.
Task 9: Ruling: FormSheet gets a `saveDisabled?: boolean` prop rather than inventing an i18n key for "name required". It mirrors the route sheet's existing `disabled={!canSaveRoute}` and needs no new translation in three languages. Cost if wrong: the owner sees a disabled Save rather than an explanatory message.
Task 9: minor (deferred): unused `loading` in use-notification-sources; redundant double-fetch on first open; `common.delete` used as a dialog title where the house idiom composes a sentence; Settings Card title and ListRow title both render "Bank notifications" (comes from the Task 8 key values, not this screen).
Task 9: fix round 1/5 dispatched (resumed implementer) — 4 Important + 1 promoted + 1 Minor
Task 9: fix round 1/5 (6 addressed, 0 open; commits 02d3f11..4d30783)
Task 9: complete (commits ef6ab8e..4d30783, review clean)
Task 9: minor (deferred): the new AppState listener calls `void reload()` with no .catch, so a rejected repository read surfaces as an unhandled rejection rather than an Alert. Mirrors the pre-existing useFocusEffect, which has the same gap — an existing pattern extended to a second call site, not new.
Task 10: dispatched (sonnet — inbox screen plus markers across four existing screens), BASE 4d30783
Task 10: implementer DONE — commit b1eb3c6. Its final message was malformed (no SHA, and it reported spawning a "backup verification fork", which the implementer contract forbids — a duplicate seat at full cost). Work itself landed correctly; controller verified the commit, both new files, and a clean typecheck directly.
Task 10: Ruling: the plan named the movement detail screen `app/movement/[id].tsx`; the real path is `app/transaction/[id].tsx` (only `new.tsx` lives under `movement/`). The implementer used the real one. Plan text was wrong. Cost if wrong: none, the edit is where it belongs.
Task 10: controller-verified: forecastYear and bookedYear both receive the provisional-filtered array while summarisePeriod/netWorthSeries/detectRecurring keep the full set; all five marker keys are wired (provisionalExplainer, provisionalStale, reviewChip, balanceIncluding, provisional chip).
Task 10: task reviewer dispatched (sonnet), diff 4d30783..b1eb3c6
Task 10: review — spec ❌, quality Needs fixes, 1 Critical, 2 Important, 3 Minor
Task 10: Ruling: the Critical is a real gap in my plan, which said only "navigates to /movement/new prefilled" and never specified the lifecycle. Edit-first wrote through the ordinary manual-entry path, so the movement was not provisional (invisible to reconcileProvisionals, counted as booked in the forecast, permanent duplicate once the statement lands) and the capture stayed pending (acceptable a second time). Fixed by adding acceptEditedCapture(captureId, draft) to capture-service so the lifecycle lives in one module beside acceptCapture, and threading captureId as a route param. Plan corrected. Cost if wrong: the edit-first path is the least-used of the three, but the failure it caused was silent and permanent.
Task 10: minor (deferred): `today` derived as new Date().toISOString().slice(0,10) in use-capture-inbox — UTC, so up to a day off from local wall-clock near midnight, shifting the stale count by one day. Verbatim from the brief and mirrors an existing pattern in (tabs)/index.tsx, but it sits awkwardly beside this project's own date discipline. Worth a pass with localCalendarDay later.
Task 10: minor (deferred): no unmount guard in use-capture-inbox's reload (every other new async effect in the diff has one); bare `return null` for a pending capture with parsed === null makes it invisible and undismissable if that invariant is ever violated.
Task 10: fix round 1/5 dispatched (resumed implementer) — 1 Critical + 2 Important
Task 10: process note: this implementer's report was malformed and it spawned a helper agent against the no-subagents contract. Corrected in the fix dispatch.
Task 10: fix round 1/5 (3 addressed per implementer; commits b1eb3c6..00b9771) — re-review pending after round 2
Task 10: Ruling: the implementer's own flag is correct — an edited capture was being written with source 'manual' while acceptCapture writes 'notification'. `source` records provenance, and editing an amount before saving does not change where the movement came from; manual classification is a separate axis already carried by categorySource. Fix round 2 sets it conditionally. Cost if wrong: a notification-born movement filed under the wrong origin, which nothing currently branches on but which would misreport if anything ever did.
Task 10: Ruling: the bank-level balanceIncluding aggregate and the movement/new prefill wiring are accepted as legitimate judgement, not scope creep — the brief asked for the label and for a prefilled navigation without specifying how.
Task 10: fix round 2/5 dispatched (resumed implementer) — 1 Minor-severity correctness fix
Task 10: fix rounds 1-2 re-reviewed (4 addressed, 0 open; commits b1eb3c6..e3fce8c). Verified: the ordinary `+` entry point is unchanged, the importHash discriminator matches acceptCapture's so an edited and unedited capture cannot both land, the source ternary is not inverted, and no notification text reaches the error surface.
Task 10: Ruling: promoted the re-review's out-of-scope observation into fix round 3. use-capture-inbox's reload clears `loading` only after all three reads resolve, so a rejection strands it true — and now that round 1 gates the empty state on !loading, the screen shows no data, no empty state and no error at all. My defect, from the brief's Step 1 code. Fixed with try/catch/finally plus an `error` the screen renders, and the unmount guard the rest of the task's effects already use. Plan corrected. Cost if wrong: a blank inbox that needs an app restart, in the one place the owner goes to find money the app has not confirmed.
Task 10: minor (deferred): movement/new's save ignores acceptEditedCapture's return, so a null would mark the capture accepted with a null movement id and still navigate back. Unreachable in practice (insertTransactions treats a same-hash row as a duplicate rather than a no-op, so the lookup finds either the new row or the existing one, and a real write failure throws into the existing catch), and acceptCapture makes the same trade.
Task 10: minor (deferred): if accept/dismiss succeeds but the following reload throws, the card blames the capture for an action that actually committed.
Task 10: fix round 3/5 dispatched (resumed implementer) — 1 Important
Task 10: fix round 3/5 (1 addressed, 0 open; commits e3fce8c..ef410f5)
Task 10: complete (commits 4d30783..ef410f5, review clean after 3 rounds)
Plan/spec corrections committed as 75e8925.
Task 11: BLOCKED — needs real notification strings from the owner. Cannot be written from a guess; that is the rule this repo already applies to statement layouts, and it matters more here because push wording is unversioned. NOTIFICATION_PARSERS stays empty until then, which is a working state: an allowlisted app with no template produces an `unreadable` capture, which is exactly what the inbox exists to show.
Task 12: docs portion dispatched (sonnet). Steps 1-4 (security-model.md, data-model.md, README.md, CLAUDE.md) can be written now. Step 5's device checklist is blocked on the JDK, and step 7's merge is the owner's call, presented rather than performed.
Task 12: implementer DONE — commit 69fee5e (docs steps 1-4). Steps 5-7 correctly deferred.
Task 12: review — spec ❌ on two omissions, quality Needs fixes, 2 Important, 2 Minor. Reviewer read fourteen source files to check the docs against the code; every factual claim matched, and it found no overclaiming of observed behaviour anywhere.
Task 12: Ruling: the brief misattributed the "No bank connection, no aggregator: every import is a file the owner picks by hand" sentence to README; it lives at CLAUDE.md:6. The implementer was right to catch that and right to leave README's own still-true sentence alone, but having found it, it needed correcting there. Fixing in round 1. Cost if wrong: the project's own instructions file contradicts its Conventions section three lines later.
Task 12: Ruling: the permanent iOS asymmetry is stated nowhere. All four files say "Android only"; none says it is structural. The code already says it plainly in the Swift stub. Adding the reason in each file's own register. Cost if wrong: a reader concludes iOS support is pending when no API exists and none ever has.
Task 12: fix round 1/5 dispatched (resumed implementer) — 2 Important + 2 Minor
Task 12: fix round 1/5 (4 addressed, 0 open; commits 69fee5e..ddec4b6)
Task 12: complete (commits 75e8925..ddec4b6, review clean) — docs only; its device checklist stays undone.
Final whole-branch review dispatched (opus), merge-base 8f11356..ddec4b6, 29 commits / 57 files / +7330 -65
Final review (opus): Needs fixes before merge — 0 Critical, 8 Important, 10 Minor, 14 deferred minors triaged (13 correctly deferred, 1 folded into an Important).
Final fix wave: 12 commits ddec4b6..bc0a311, all twelve findings addressed.
Final re-review (opus): all twelve verified addressed; 2 Important introduced by the wave itself, 4 Minor.
PARKED — Task 10/final: Ruling: `hasUnsettledCaptureFor` lists 'accepted' in its status filter, but `setCaptureStatus` NULLs title and body on every settle, so an accepted row can never match a predicate comparing non-null text. The exact path the comment names as dangerous — auto-approve on, capture settled, Android reposts with a fresh postTime — is therefore still unsuppressed and would write a second provisional. UNREACHABLE TODAY: NOTIFICATION_PARSERS is empty, so nothing can reach a `movement` verdict at all. Parked rather than fixed because the process allows one fix wave and this is its residue, and because Task 11 — the task that writes the first parser — is exactly what makes it reachable. It must be fixed as a prerequisite of Task 11, not after it. The fix is to match an accepted row on android_key alone, since its text is deliberately gone.
PARKED — Task 10/final: Ruling: three prose sites (notification-captures-repo.ts:31-33, capture-service.ts:57-61, docs/security-model.md:86-91) claim the key check catches a bank updating "payment pending" into "payment completed". The predicate requires identical title AND body, so a text change fails it. The code is to spec; the prose overstates it. Live and misleading today, unlike the item above. Parked only because it travels with the same fix. This branch's one real quality signal is that its docs tell the truth about the code, so this should not ship uncorrected.
Minor (deferred, final wave): movement/new ignores acceptEditedCapture's null and calls router.back() regardless, discarding an edited draft if the capture settled meanwhile; two same-text same-key payments now suppress the second provisional (the statement still books it); a throw in ambiguousProvisionals hides pending captures because it shares the hook's Promise.all; learning mode can return an empty list with no explanation if the app was backgrounded past expiry.
Merge readiness (reviewer): the risky parts of the wave hold up under reading; the branch typechecks and passes 534 tests; the two Important residues should be fixed before merge.
