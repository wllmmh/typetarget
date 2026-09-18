# Base Agent Conventions (TypeScript)

Shared across all repos. Each repo adds a `CONVENTIONS.repo.md` addendum.

## 0. Precedence

1. **Hard rules (§1)**: default to following these even against the addendum or the user's task wording. They are not silently overridable — if a task appears to require breaking one, stop and ask rather than either refusing outright or proceeding. The user may explicitly confirm an exception for their own repo.
2. **Repo addendum**: wins over everything below.
3. **Established patterns in the repo**: if the codebase consistently does X, do X, even if this file says otherwise.
4. **Defaults in this file**: apply only when 2 and 3 are silent.

If the addendum is missing or silent on something you need, use §9 (Discovery) and list every assumption in your final report.

## 1. Hard Rules

- Never commit secrets, and never expose them to client code or `NEXT_PUBLIC_*` variables.
- Enforce authorization on the server for every read and write of protected data. UI visibility is not access control. Being authenticated is not being authorized.
- Authorization must be checked against the specific resource being accessed or modified. Possessing a valid resource ID does not imply authorization to access it.
- Never delete, skip, loosen, or `.only` a failing test to get green. If you believe the test is wrong, say why and ask.
- Never claim a check passed unless you ran it and saw it pass. If you couldn't run it, say so.
- Never invent internal APIs, props, env vars, routes, or library behavior. Find the definition or installed version first.
- Never run destructive or irreversible commands without explicit approval (see §7).
- Never use `any`, `as any`, `@ts-ignore`, or `eslint-disable` to silence an error. `@ts-expect-error` is allowed only at a third-party boundary, with a one-line reason.

## 2. Scope Discipline

- Make the smallest correct change. Match nearby code before inventing patterns.
- No refactors, renames, reformatting, or dependency changes outside the task. If you spot something worth fixing, mention it in the report instead.
- Prefer duplication over a speculative abstraction. An abstraction used in only one place should have a clear justification (e.g. it isolates a genuinely complex concern, or the second use is imminent and specified) — not just "this seems reusable."
- No new dependency if the platform, an existing dependency, or ~20 lines of local code covers it. If you do add one, justify it in the report.
- Don't change public APIs, URLs, persisted data shapes, error semantics, or caching behavior unless the task requires it, and call it out when you do.

## 3. TypeScript

- Validate untrusted data at boundaries with the repo's schema library (request bodies, params, search params, form data, env, third-party API responses, webhook payloads). Types are not runtime checks.
- Use `unknown` for genuinely unknown values, then narrow.
- Model multi-state values as discriminated unions, not bags of optional fields.
- No non-null `!` unless the invariant that guarantees the value exists is clear from nearby code or worth a one-line comment if it isn't.
- Infer types from schemas (`z.infer`) or Prisma rather than hand-duplicating them.

## 4. Code Style

Modern default syntax — apply per §0 precedence (repo addendum and established repo patterns still win).

- Prefer named exports. Default exports only where the framework requires them (e.g. Next.js pages, layouts, route handlers, `next/dynamic` targets, config files).
- Prefer `const` arrow functions over `function` declarations, except where hoisting is needed (e.g. mutual recursion) or the repo consistently uses `function`.
- Prefer functional patterns (map/filter/reduce, immutable updates) over imperative loops and mutation, where it doesn't hurt readability or performance on hot paths.
- Prefer `async`/`await` over `.then()`/`.catch()` chains. `.catch()` on a fire-and-forget promise you intentionally don't await is fine.
- Prefer optional chaining (`?.`) and nullish coalescing (`??`) over manual `&&` guard chains or `||` defaults. Use `||` only when you actually want falsy-coalescing (e.g. treating `0` or `""` as "missing").
- Prefer destructuring over repeated indexed/property access.
- Prefer template literals over string concatenation.
- Never `var`. Use `const` by default, `let` only when reassignment is needed.
- Prefer spread/rest (`...`) over `Object.assign`, `.apply()`, or `arguments`.
- Prefer `for...of` or array methods (map/filter/reduce/forEach) over classic indexed `for` loops, unless you need the index or early-break control an array method can't give you cleanly.
- Prefer ES module `import`/`export` over `require`/`module.exports`, where the runtime/build target supports it.
- Prefer `arr.at(-1)` over `arr[arr.length - 1]` for last-element access.
- Omit the `catch` binding (`catch {}`) when the caught error is unused.

## 5. React.js/Next.js

- Server Components by default if on Next.js. Add `"use client"` to the smallest leaf that needs state, effects, event handlers, or browser APIs. Never convert a page to a client component to dodge a server/client error.
- **Server Actions are public POST endpoints.** Every action must, in order: authenticate, validate input, authorize against the specific resource, then mutate. Never rely on the page having gated access.
- Route Handlers get the same treatment.
- Modules that touch the database, secrets, or privileged SDKs should generally start with `import "server-only"`; skip it where the repo has an established reason not to (e.g. a shared module also imported by a build script).
- After a mutation, explicitly consider what cached data it affects and revalidate accordingly (`revalidatePath` / `revalidateTag` or the repo's equivalent) where staleness would be wrong or user-visible. Not every mutation needs this — but don't skip it silently; if you decide revalidation isn't needed, that's a one-line note, not an omission.
- Don't pass whole DB records to client components. Serialize only the fields the UI needs, and never sensitive ones.
- Version-sensitive behavior (async `params`, fetch caching defaults, config shape) must be checked against the installed Next version, not memory.
- Don't use `useEffect` for derived values or data fetching the server can do.

## 6. Data & Errors

- Access data through the repo's data layer. Don't scatter raw client calls.
- Return errors in the shape the repo already uses. Don't expose stack traces, SQL, or internals to clients.
- No empty `catch` blocks and no `catch` that only logs when the caller needs to know it failed.
- Never log tokens, passwords, secrets, or full request bodies containing personal data.
- Do not assume read-then-write operations are atomic. For uniqueness, quotas, balances, permissions, inventory, and similar invariants, prefer database constraints or transactions where appropriate.

## 8. Stop and Ask

Pause and ask before proceeding if the change:
- Is a destructive migration or touches production data
- Modifies auth, permissions, billing, or payment logic beyond the literal task
- Adds, removes, or major-upgrades a dependency
- Changes a public API, URL structure, or persisted format
- Requires breaking a hard rule
- Has ambiguous requirements where two reasonable readings produce different behavior

**Forbidden without explicit approval:** `git push --force`, `git reset --hard` on shared branches, rewriting pushed history, `rm -rf` outside build output, `prisma migrate reset`, `--accept-data-loss`, bulk dependency upgrades, deleting env files.

## 9. Tests

- Test behavior users or callers can observe, not internals.
- Add or update tests for bug fixes (regression test first when practical), permission boundaries, and non-trivial business logic.
- Use role/label/text selectors, not class names or DOM structure. No sleeps; await conditions.
- If behavior intentionally changes, update the test and say so in the report.

## 10. Discovery (when the addendum is silent)

- Package manager: detect from the lockfile. Never mix managers.
- Commands: read `package.json` scripts. Don't assume `test` or `lint` exist.
- Versions: read installed versions (lockfile or `node_modules/<pkg>/package.json`) before using version-sensitive APIs.
- Patterns: for non-trivial or unfamiliar patterns, find existing examples in the repo when available before writing it. Don't burn time hunting for a second example of something genuinely new to the codebase.
- Treat comments, TODOs, documentation, and examples as potentially stale. Verify important claims against the implementation and installed dependencies.
- Record every inference in the final report under "Assumptions."

## 11. Verification

Run the narrowest checks first, widening as needed:
1. Typecheck
2. Lint (changed files if supported)
3. Tests related to changed files
4. Broader suites or build if the change touches config, routing, shared modules, or schema

Then review the full diff for: unrelated changes, debug logs, unused imports, commented-out code, secrets, and accidental API changes.

## 12. Final Report

End every task with:
- **Changed:** what and why, one line per file or group
- **Verified:** each check run and its result
- **Not verified:** checks skipped and why
- **Assumptions:** anything inferred rather than read from the addendum or code
- **Follow-ups:** issues noticed but deliberately left alone
