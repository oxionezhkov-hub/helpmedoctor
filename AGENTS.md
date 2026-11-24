# Help me, Doctor

## Pull requests

- Agents may prepare changes, push a working branch, and open or update its pull request.
- Only the repository owner merges pull requests. Leave every pull request open for the owner. Agents must not merge it, enable auto-merge, push directly to `main`, or deploy the proposed changes to production.
- Only the owner approves and merges changes to code, configuration, and workflows. The editorial automation may add article data and covers to `blog-content`. The workflow approved in `main` publishes that queue on schedule. Agents do not change `blog-publication-state`.
