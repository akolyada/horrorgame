Commit all changes, push to remote, build and deploy to server — all in one go.

Steps:
1. Run `git add -A` to stage all changes.
2. Look at the diff of staged changes and recent git log to understand the commit style.
3. Create a commit with a concise message describing the changes. End the message with `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.
4. Run `git push` to push to the remote.
5. Run `npm run build` to create a production build.
6. Run `bash deploy.sh` to deploy the built `dist/` to the server.
7. Report the result to the user — commit hash, push status, and deploy URL.
