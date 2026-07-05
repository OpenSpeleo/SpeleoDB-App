# GitHub Actions Auth Integration Tests

When SpeleoDB integration tests run on GitHub-hosted runners, the password-login
endpoint can return `403` even with credentials that work locally. Do not
diagnose that as a secret mismatch until the token-validation path is checked
separately.

Rules:

- Keep full CI Vitest runs in one-shot mode with `--run` and serialize test
  files when they hit the same real auth account.
- Treat hosted-runner password-auth `403` as an environment-specific block only
  after validating the configured OAuth token against the same instance.
- Keep local integration tests strict so bad credentials still fail during
  developer verification.
