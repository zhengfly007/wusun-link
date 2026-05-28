#!/usr/bin/env python3
"""
GitHub Issue → Feishu notification script.
Checks for new issues and new comments on existing issues.
Outputs: nothing if unchanged, JSON notification if new activity.
Designed for no_agent cron mode — stdout is delivered verbatim.
"""

import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone

REPO = "zhengfly007/wusun-link"
STATE_FILE = os.path.expanduser("~/.hermes/data/wusun-link-issue-state.json")
GITHUB_API = "https://api.github.com"

def fetch(url):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Hermes-Issue-Watcher/1.0",
    })
    # Pass gh auth token if available
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            print(f"[403] GitHub API rate limit hit")
        return None
    except Exception as e:
        print(f"[error] {e}")
        return None

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"last_check": None, "known_issues": {}}

def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def main():
    state = load_state()
    now = datetime.now(timezone.utc).isoformat()
    
    # Fetch open issues
    issues = fetch(f"{GITHUB_API}/repos/{REPO}/issues?state=open&per_page=10")
    if issues is None:
        return  # silent on API failure
    
    alerts = []
    known = state.get("known_issues", {})
    
    for issue in issues:
        # Skip pull requests
        if "pull_request" in issue:
            continue
            
        issue_id = str(issue["number"])
        title = issue["title"]
        url = issue["html_url"]
        created = issue["created_at"]
        user = issue["user"]["login"]
        
        # New issue detection
        if issue_id not in known:
            alerts.append({
                "type": "new_issue",
                "number": issue["number"],
                "title": title,
                "user": user,
                "url": url,
                "created": created,
            })
            known[issue_id] = {
                "title": title,
                "comments": issue["comments"],
                "created": created,
                "last_updated": now,
            }
        else:
            # Check for new comments
            prev_comments = known[issue_id].get("comments", 0)
            curr_comments = issue["comments"]
            
            if curr_comments > prev_comments:
                # Fetch latest comment
                comments = fetch(f"{GITHUB_API}/repos/{REPO}/issues/{issue_id}/comments?per_page=5")
                if comments:
                    new_count = curr_comments - prev_comments
                    latest = comments[-1]
                    alerts.append({
                        "type": "new_comment",
                        "number": issue["number"],
                        "title": title,
                        "user": latest["user"]["login"],
                        "body": latest["body"][:300],
                        "url": latest["html_url"],
                        "new_count": new_count,
                    })
                known[issue_id]["comments"] = curr_comments
                known[issue_id]["last_updated"] = now
            elif curr_comments < prev_comments:
                # Reset on desync
                known[issue_id]["comments"] = curr_comments
    
    # Check for closed issues (removed from open list)
    current_ids = {str(i["number"]) for i in issues if "pull_request" not in i}
    for issue_id in list(known.keys()):
        if issue_id not in current_ids and known[issue_id].get("last_updated"):
            # Issue was closed
            alerts.append({
                "type": "closed_issue",
                "number": int(issue_id),
                "title": known[issue_id].get("title", "unknown"),
            })
            del known[issue_id]
    
    state["last_check"] = now
    state["known_issues"] = known
    save_state(state)
    
    if not alerts:
        return  # silent — no news is good news
    
    # Format output
    print(f"📬 wusun-link GitHub 动态 | {datetime.now().strftime('%m/%d %H:%M')}")
    print()
    for a in alerts:
        if a["type"] == "new_issue":
            print(f"🆕 新Issue #{a['number']}: {a['title']}")
            print(f"   提出: {a['user']}  |  链接: {a['url']}")
        elif a["type"] == "new_comment":
            print(f"💬 #{a['number']} {a['title']} 有新回复 ({a['user']})")
            print(f"   回复摘要: {a['body'][:120]}...")
            print(f"   链接: {a['url']}")
        elif a["type"] == "closed_issue":
            print(f"✅ Issue #{a['number']}: {a['title']} — 已关闭")
        print()

if __name__ == "__main__":
    main()
