# Tools

Reusable scripts grown by agents during work. Commit anything here that
helps a future session. Naming: verb_subject.sh e.g. validate_vm.sh

## Getting tools from ash-repo-tools (private repo)
Token is auto-detected from the gh cli. Example:

  TOKEN="$(gh auth token 2>/dev/null || echo "${GITHUB_TOKEN:-}")"
  curl -fsSL -H "Authorization: token ${TOKEN}" \
    https://raw.githubusercontent.com/PaprikaCayenne/ash-repo-tools/master/tools/<name>.sh \
    -o tools/<name>.sh && chmod +x tools/<name>.sh
