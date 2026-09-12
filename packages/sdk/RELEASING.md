# Releasing `@latchprotocol/sdk`

Monorepo-only. This file does not travel to the public mirror — it is instructions for the
person cutting the release, not for a consumer of the package.

**Publish from `packages/sdk` in the monorepo, never from the mirror.** The mirror's
`package.json` has had its ABI generators stripped by `scripts/sync-public-repo.mjs`, so a
publish from there cannot regenerate anything and would ship whatever `src/*/generated`
happened to contain.

---

## The one thing Claude cannot do

**npm 2FA.** `npm publish` returns `EOTP` and needs a one-time password. There is no TTY in
the agent's shell to type it into and the browser-auth URL npm prints comes back redacted,
so the final command has to be run by a human in a real terminal. Everything before it can
be automated; that step cannot.

---

## Release

```powershell
cd C:\Users\Admin\Desktop\PROJECTS\Hook-Dev\packages\sdk

npm whoami                      # expect: oxforged
npm org ls latchprotocol        # expect: oxforged - owner

npm publish --dry-run           # builds, tests, packs — changes nothing
npm publish --access public     # the real one. Enter the OTP when prompted.
```

`--access public` is belt and braces: `publishConfig.access` in `package.json` already says
public. A SCOPED package defaults to RESTRICTED, and a restricted publish on a free account
fails rather than silently shipping something nobody can install — but state it anyway.

### What `npm publish` runs for you

`prepublishOnly` is `npm run generate:check && npm run build && npm test`, in that order,
and each one is there for a reason:

- **`generate:check`** exits non-zero if any generated ABI is stale relative to the Foundry
  artifacts. Without it a release can ship types that describe a contract shape nobody
  deployed — and the failure mode is a decode that returns nonsense rather than throwing,
  which is the single most expensive bug class in this repo.
- **`build`** regenerates and compiles. Before this hook existed, `npm publish` packed
  whatever `dist/` last happened to hold, with no build. A publish is exactly the moment
  that matters.
- **`test`** — 159 of them. A green suite is cheap; a bad version on npm is permanent.

If any of the three fails, nothing is published.

---

## Verify, after

```powershell
npm view @latchprotocol/sdk version
npm view @latchprotocol/sdk dist.shasum      # compare to the shasum printed by publish
cd $env:TEMP; npm pack @latchprotocol/sdk    # download the real tarball and look inside
```

Then tag the source it came from:

```powershell
cd C:\Users\Admin\Desktop\PROJECTS\Hook-Dev
git tag -a sdk-v0.1.0 -m "@latchprotocol/sdk 0.1.0"
git push origin sdk-v0.1.0
```

A published version with no tag is a version whose source nobody can identify later.

---

## What ships, and what does not

`files` in `package.json` is the allow-list: `dist`, `schema.graphql`, `README.md`,
`LICENSE`. Nothing else, whatever else is sitting in the directory.

Deliberately NOT in the tarball, though both are in the git mirror:

| | Why |
|---|---|
| `assets/og.png` | 90 KB social-preview image. A dependency should not carry one. |
| `prompts/` | Integration prompts are repository content for a human. |

Current shape: **84 files · 134.9 kB packed · 1.1 MB unpacked.** A release that jumps
sharply from that without an obvious reason is worth opening before pushing.

---

## Later releases

```powershell
npm version patch     # or minor / major — writes package.json AND commits AND tags
npm publish --access public
```

`npm version` makes the commit and tag itself, so do not hand-edit the version field first.

**Then re-sync the mirror**, or the public repo silently describes a version that is no
longer what npm serves:

```powershell
cd C:\Users\Admin\Desktop\PROJECTS\Hook-Dev\packages\sdk
node scripts/sync-public-repo.mjs --dest C:\Users\Admin\Desktop\PROJECTS\latch-sdk
cd C:\Users\Admin\Desktop\PROJECTS\latch-sdk
git add -A; git commit -m "mirror @latchprotocol/sdk <version>"; git push
```

### Semver here is a promise about ADDRESSES as much as about types

`src/deployments/index.ts` is the address book, and four of its entries are named in
`REDEPLOYABLE_CONTRACTS` because they move. A redeploy that changes a live address is a
**minor** bump at least — never a patch. Somebody pinned to `~0.1.0` and reading a retired
registry gets a healthy-looking empty marketplace and no error at all.

---

## If a release goes wrong

- **Within 72 hours** and nothing depends on it: `npm unpublish @latchprotocol/sdk@<version>`.
  Registry policy allows it in that window only, and the version number is burned either
  way — you cannot republish it.
- **After 72 hours:** you cannot remove it. Publish a fixed version and
  `npm deprecate @latchprotocol/sdk@<bad> "use >=<good>"`, which shows a warning on install.
- **A secret got published:** rotate the credential FIRST, then deal with the package.
  Unpublishing does not un-copy a tarball that mirrors and caches already fetched.

---

## CI, if it ever runs the publish

Use a **granular access token** scoped to `@latchprotocol` with write access, in
`NODE_AUTH_TOKEN`. Note npm's own warning on the login screen: tokens that bypass 2FA are
being restricted for direct publishing (<https://gh.io/npm-gat-bypass2fa-deprecation>), so
treat an automated publish as something to re-check rather than set and forget.

Never put a token in a file in this repo. `.npmrc` with a literal token is the same mistake
as a committed `.env`, and the root `.gitignore` should not be the only thing standing
between you and it.
