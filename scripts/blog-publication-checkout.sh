#!/usr/bin/env bash
set -euo pipefail

mode="$1"
branch="$2"
target="$3"
case "$mode:$branch" in
  read:blog-content|read:blog-publication-state|write:blog-publication-state) ;;
  *) exit 1 ;;
esac

ref="refs/heads/$branch"
remote=$(git ls-remote --heads origin "$ref")
if [[ -n "$remote" ]]; then
  git fetch --no-tags origin "$ref"
  if [[ "$mode" == write ]]; then
    git worktree add --detach "$target" FETCH_HEAD
  else
    mkdir -p "$target"
    git archive FETCH_HEAD | tar -xf - -C "$target"
  fi
elif [[ "$mode" == write ]]; then
  git worktree add --detach "$target" HEAD
  git -C "$target" rm -rfq -- .
else
  mkdir -p "$target"
fi
