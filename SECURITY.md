# Security policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab, "Report a vulnerability") instead of a public issue. Include steps to reproduce, the affected version and the browser. Do not attach personal media.

You can expect an acknowledgement within a few days. This is a personal open-source project, so fix timelines are best-effort.

## Scope

In scope: the web application and its build (XSS, CSP bypass, unsafe parsing of media/project/archive files, data leaving the device, dependency vulnerabilities).
Out of scope: vulnerabilities in browsers or operating systems, and issues requiring a malicious local user account.

## Design commitments

Everything runs locally; there is no backend, account system or analytics. See [docs/architecture/security-privacy.md](docs/architecture/security-privacy.md) for the threat model and the Content Security Policy.
