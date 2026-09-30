# Changelog

This file records source changes. The package version in `package.json` does not establish a public npm release.

## Unreleased review changes

- Require an operator allowlist for HTTPS Tutor Card fetches, reject redirects and oversized responses, and limit inline documents to 256 KiB.
- Align nested-field, version, age-range, and under-13 COPPA declaration validation with the Tutor Card draft. A card that previously returned `valid: true` despite an under-13/COPPA contradiction now returns `valid: false`.
- Keep the explicit `tutor_card_coppa_check` diagnostic available for inconsistent disclosures.
- Update documentation to describe source installation and publisher claims accurately; update locked transitive dependencies within existing declared ranges.

## Observed source milestones

- 2026-05-12: initial six-tool MCP Tutor Card server, version 0.1.0 in source.
- 2026-06-01: Dependabot workflow.
- 2026-08-04: Vitest dependency maintenance.
- 2026-08-05: CodeQL workflow.
