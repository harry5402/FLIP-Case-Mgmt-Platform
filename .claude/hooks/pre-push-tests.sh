#!/bin/bash
# PreToolUse hook: run the test suite before any `git push` and block the push if tests fail.
cmd=$(jq -r '.tool_input.command // ""')
case "$cmd" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
if ! out=$(npm test 2>&1); then
  echo "$out" | tail -40 >&2
  echo "PUSH BLOCKED: the automated tests failed, so this change can't go live. Explain the failure to the user in plain language and fix it before trying again." >&2
  exit 2
fi
exit 0
