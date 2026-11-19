# Release checklist (v1.0)

Everything an automated test can check is checked by `pnpm check` and `pnpm test:e2e` and must be green. This list is for
what a person has to do or look at. Mark each line with the date and name when done.

## Before tagging

- [ ] `pnpm check` and the full end-to-end suite pass on the release commit, with no skipped test that is skipped for a reason that applies on the release machine.
- [ ] `pnpm audit --prod --audit-level high` reports nothing (SEC-6).
- [ ] `docs/third-party.md` is current (`pnpm check:notices`) and every licence is allowed (`pnpm check:licences`); the one licence "to be careful with" (mediabunny, MPL-2.0) is used unmodified and its source stays available.
- [ ] `CHANGELOG.md` has the release section and the version in `package.json` and `apps/web/package.json` is the release number.
- [ ] No open issue of high severity (a crash, a lost edit, a wrong export).

## By hand (cannot be automated here)

- [ ] **Hardware encode:** export a 1080p project on a computer with a hardware encoder (Intel, AMD, Nvidia or Apple) with the encoder set to "Prefer the graphics chip"; check the file plays and passes the built-in check.
- [ ] **File System Access:** "Save straight to a file on disk" with a real file in Chrome and in Edge; cancel the "save as" window (nothing changes), pick a file (it is complete), and close the tab in the middle (no half file is presented as finished).
- [ ] **Safari and Firefox:** open the app, read the limitations notice, create an image project, edit and export an image; open a video project and check that unsupported features are explained, not blank.
- [ ] **Installed app and offline:** install the app, go offline, reload: the shell opens and an existing project can be edited. Deploy a second build, come back online: the "new version" banner appears and "Update now" reloads into the new version.
- [ ] **Screen reader pass** (NVDA or VoiceOver): start screen, an image project (layers list, properties), a video project (timeline clips, inspector, export dialog).
- [ ] **Keyboard only:** every command reachable without a mouse in both editors; focus visible everywhere; Escape closes dialogs.
- [ ] **Reduced motion and both themes** on the start screen, an image project and a video project.
- [ ] **Long export:** a 10 minute project exported in parts, interrupted by closing the tab, then continued.
- [ ] **60 minute soak:** play and scrub for an hour (`spikes/s9-soak/run.mjs 60`); memory must level off (the 30 minute run did not fully level off on shared graphics memory, see `spikes/results/s9-soak.md`).

## Tag and publish

- [ ] Merge to the release branch with a merge commit, tag `v1.0.0`, push the tag.
- [ ] Publish the built `apps/web/dist` to static hosting with the headers described in `docs/engineering/deployment.md` (the strict CSP first of all); open the live site and run the shell checks (no third-party requests, CSP present).
- [ ] Record the demo project and the walkthrough (not part of the repository).
