# Security Policy

## Reporting a vulnerability

Please do not report security issues in public GitHub issues, discussions, or pull requests.

Instead, email [i@xi-xu.me](mailto:i@xi-xu.me) with the subject line `Xdrop security report`.

Include as much of the following as you can:

- a description of the issue and the impacted component
- reproduction steps or a proof of concept
- the potential impact and any assumptions required for exploitation
- whether the issue affects confidentiality, integrity, availability, or key handling
- any suggested fix or mitigation, if you have one

If your report involves share links, uploaded files, or secrets, sanitize them before sending.
Never post real `#k=` fragments in public places.

## What to expect

- We aim to acknowledge reports within 72 hours.
- We aim to provide an initial assessment within 7 days.
- We may ask for more detail, a smaller reproduction, or time to validate a fix.
- We will coordinate disclosure timing with the reporter when a report is confirmed.

## Scope notes

Xdrop is a file transfer system with browser-side encryption. Security-sensitive areas include:

- key generation, wrapping, and fragment handling
- client-side encryption and decryption flows
- manifest and chunk storage behavior
- share-link lifecycle, expiry, and delete controls
- secrets, environment configuration, and deployment defaults

Operational or configuration questions that are not vulnerabilities belong in [SUPPORT.md](SUPPORT.md).
