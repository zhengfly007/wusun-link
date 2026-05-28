#!/usr/bin/env python3
"""
wusun-link 仓库活跃度状态采集
每8小时采集一次，记录 stars/issues/forks/commits/releases 变化。
输出：有变化时输出状态摘要，无变化时静默。
设计为 no_agent cron，输出即投递。
"""

import json
import os
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone

REPO = "zhengfly007/wusun-link"
STATE_FILE = os.path.expanduser("~/.hermes/data/wusun-repo-status.json")

def gh_api(path):
    url = f"https://api.github.com{path}"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Hermes-Repo-Watcher/1.0",
    })
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        try:
            r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                token = r.stdout.strip()
        except:
            pass
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except:
        return None

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}

def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def main():
    state = load_state()
    prev_stars = state.get("stars", 0)
    prev_forks = state.get("forks", 0)
    prev_issues = state.get("open_issues", 0)
    prev_commit = state.get("latest_commit_sha", "")
    prev_release = state.get("latest_release", "")

    # Repo info
    repo = gh_api(f"/repos/{REPO}")
    if not repo:
        return  # silent

    now_stars = repo.get("stargazers_count", 0)
    now_forks = repo.get("forks_count", 0)
    now_issues = repo.get("open_issues_count", 0)
    pushed_at = repo.get("pushed_at", "")

    # Latest commit
    commit_data = gh_api(f"/repos/{REPO}/commits?per_page=1")
    now_commit_sha = ""
    now_commit_msg = ""
    now_commit_date = ""
    if commit_data and len(commit_data) > 0:
        c = commit_data[0]
        now_commit_sha = c["sha"][:7]
        now_commit_msg = c["commit"]["message"].split("\n")[0][:60]
        now_commit_date = c["commit"]["author"]["date"]

    # Latest release
    rel_data = gh_api(f"/repos/{REPO}/releases?per_page=1")
    now_release = ""
    if rel_data and len(rel_data) > 0:
        now_release = rel_data[0].get("tag_name", "")

    # Open issues list (for summary)
    issue_data = gh_api(f"/repos/{REPO}/issues?state=open&per_page=10")
    open_issue_titles = []
    if issue_data:
        for issue in issue_data:
            if "pull_request" not in issue:
                open_issue_titles.append(f"#{issue['number']} {issue['title']}")

    # Detect changes
    changes = []
    if now_stars != prev_stars:
        changes.append(f"stars {prev_stars}→{now_stars}")
    if now_forks != prev_forks:
        changes.append(f"forks {prev_forks}→{now_forks}")
    if now_issues != prev_issues:
        changes.append(f"issues {prev_issues}→{now_issues}")
    if now_commit_sha and now_commit_sha != prev_commit:
        changes.append(f"新commit: {now_commit_sha} \"{now_commit_msg[:40]}\"")
    if now_release and now_release != prev_release:
        changes.append(f"新release: {now_release}")

    # Save current state
    state["stars"] = now_stars
    state["forks"] = now_forks
    state["open_issues"] = now_issues
    state["latest_commit_sha"] = now_commit_sha
    state["latest_commit_msg"] = now_commit_msg
    state["latest_commit_date"] = now_commit_date
    state["latest_release"] = now_release
    state["last_check"] = datetime.now(timezone.utc).isoformat()
    state["pushed_at"] = pushed_at
    save_state(state)

    if not changes and now_stars == 0:
        # Brand new repo, no activity ever — stay fully silent
        return

    # Output
    now_str = datetime.now().strftime("%m/%d %H:%M")
    if changes:
        print(f"📦 wusun-link 仓库更新 | {now_str}")
        print()
        for c in changes:
            print(f"  • {c}")
        if open_issue_titles:
            print()
            print(f"  📋 开放Issue ({now_issues}):")
            for t in open_issue_titles[:3]:
                print(f"    {t}")
            if len(open_issue_titles) > 3:
                print(f"    ...还有{len(open_issue_titles)-3}个")
        print()
        print(f"  链接: https://github.com/zhengfly007/wusun-link")
    else:
        # No changes, output minimal heartbeat (one line) so context_from picks it up
        print(f"📦 wusun-link · 无变化 · {now_stars}⭐ {now_forks}🍴 {now_issues}个Issue")

if __name__ == "__main__":
    main()
