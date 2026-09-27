# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

- Use GitHub's private vulnerability reporting:
  [Perfscale/sdk-libraries → Security → Advisories → Report a vulnerability](https://github.com/Perfscale/sdk-libraries/security/advisories/new)
- Or email the maintainers via the contact on the
  [Perfscale organization](https://github.com/Perfscale) profile.

We aim to acknowledge reports within 3 working days and to ship a fix or a
documented mitigation within 30 days, severity permitting.

## Scope

- `@perfscale/library-sdk` (the `ts/` package) and its
  `perfscale-library-build` CLI.
- The example component and build tooling in this repository.

Bugs in the engine's WASM sandbox (capability enforcement, wasmtime
integration) belong to [Perfscale/perfscale](https://github.com/Perfscale/perfscale)
— report them there instead.

## Supported versions

Only the latest minor line receives security fixes:

| Version | Supported |
|---|---|
| 0.1.x (latest) | ✓ |
| older | ✗ |

## Supply-chain posture

- The package publishes from GitHub Actions with a **provenance
  attestation** (sigstore) — verify with
  `npm audit signatures` or the provenance link on the npm package page.
- GitHub Actions are pinned by commit SHA; the package has **zero runtime
  dependencies** and CI gates on `npm audit --omit=dev --audit-level=high`.
