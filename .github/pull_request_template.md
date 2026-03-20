## Summary

Describe the change and the user-visible impact.

## Linked issues

Closes #

## Verification

- [ ] `npm run format:check`
- [ ] Relevant frontend checks (`npm run lint:web`, `npm run typecheck:web`, `npm run test:web`)
- [ ] Relevant backend checks (`cd apps/api && go test ./... -coverprofile=coverage.out -covermode=atomic`)
- [ ] `npm run test:e2e` for full-stack or user-flow changes

## Checklist

- [ ] The change fits the current project scope
- [ ] Tests were added or updated when behavior changed
- [ ] Docs were updated when setup, behavior, or contributor workflow changed
- [ ] Screenshots or recordings are attached for UI changes
- [ ] Config, Docker, API contract, or security-sensitive changes are called out below

## Notes for reviewers

Add anything reviewers should pay extra attention to.
