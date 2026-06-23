# Security Policy

## Supported versions

Only the latest published version receives security fixes.

## Reporting a vulnerability

Open a [private security advisory on GitHub](https://github.com/eiei114/pi-skill-playbook/security/advisories/new), or contact the maintainer by the preferred channel listed in the repository profile.

Please include:

- Affected version
- Impact
- Reproduction steps
- Suggested fix, if known

## Pi package security note

Pi packages can execute code with local user permissions. Review installed packages and avoid running untrusted extensions.

## Local data

Playbook run state is stored only in `.pi/playbook-runs/` inside the target project. This extension does not send run data to remote services.
