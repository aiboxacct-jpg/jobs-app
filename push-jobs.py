#!/usr/bin/env python3
"""Push ~/workspace/jobs-app-src/ to GitHub repo aiboxacct-jpg/jobs-app via
the git data API (same proven pattern as push-personal.py).

The repo starts EMPTY: the git-data blob endpoint 409s on a completely
empty repo, so on first run this seeds it with the README through the
Contents API, then does the normal blob/tree/commit/ref flow.

Usage: python3 push-jobs.py "commit message"
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/templates/skill/bin")
sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

OWNER, REPO = "aiboxacct-jpg", "jobs-app"
SRC = os.path.expanduser("~/workspace/jobs-app-src")
TEXT_EXT = {".html", ".css", ".md", ".txt", ".js", ".mjs", ".json", ".sql",
            ".svg", ".xml", ".py", ".example", ".gitignore"}
SKIP_DIRS = {"node_modules", ".next", ".git", "out"}
SKIP_FILES = {".env", ".env.local", ".env.development.local",
              ".env.production.local"}


def api(method, path, body=None):
    h = {"Accept": "application/vnd.github+json", "User-Agent": "muse-github-skill"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request("https://api.github.com" + path, data=data, method=method, headers=h)
    add_surrogate_to_request(req, "custom.github", allowed_hosts=("api.github.com",))
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, read_json_response(exc)
        except Exception:
            return exc.code, {"message": exc.read().decode("utf-8", "replace")[:400]}


def collect_files():
    files = []
    for root, dirs, names in os.walk(SRC):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".next"))
        for n in sorted(names):
            if n in SKIP_FILES or n.endswith(".log"):
                continue
            rel = os.path.relpath(os.path.join(root, n), SRC)
            files.append(rel)
    return files


def seed_if_empty():
    st, ref = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main")
    if st == 200:
        return ref["object"]["sha"]
    # Empty repo: create the first commit via the Contents API.
    with open(os.path.join(SRC, "README.md"), "rb") as f:
        content = base64.b64encode(f.read()).decode()
    st, res = api("PUT", f"/repos/{OWNER}/{REPO}/contents/README.md",
                  {"message": "Initial commit (seed)", "content": content,
                   "branch": "main"})
    if st not in (200, 201):
        print(f"seed README: {st} {json.dumps(res)[:300]}")
        sys.exit(1)
    print(f"seeded repo via Contents API: {res['commit']['sha'][:10]}")
    return res["commit"]["sha"]


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else "Update jobs app"
    parent = seed_if_empty()
    files = collect_files()
    tree = []
    for rel in files:
        with open(os.path.join(SRC, rel), "rb") as f:
            raw = f.read()
        ext = os.path.splitext(rel)[1].lower()
        if ext in TEXT_EXT or rel in (".gitignore", ".env.example"):
            body = {"content": raw.decode("utf-8"), "encoding": "utf-8"}
        else:
            body = {"content": base64.b64encode(raw).decode(), "encoding": "base64"}
        st, blob = api("POST", f"/repos/{OWNER}/{REPO}/git/blobs", body)
        if st not in (200, 201):
            print(f"blob {rel}: {st} {json.dumps(blob)[:300]}")
            return 1
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"blob {rel}: {blob['sha'][:10]}")
    st, t = api("POST", f"/repos/{OWNER}/{REPO}/git/trees", {"tree": tree})
    if st not in (200, 201):
        print(f"tree: {st} {json.dumps(t)[:300]}")
        return 1
    st, commit = api("POST", f"/repos/{OWNER}/{REPO}/git/commits",
                     {"message": msg, "tree": t["sha"], "parents": [parent]})
    if st not in (200, 201):
        print(f"commit: {st} {json.dumps(commit)[:300]}")
        return 1
    st, r = api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/main", {"sha": commit["sha"]})
    print(f"ref update: {st}")
    if st not in (200, 201):
        print(json.dumps(r)[:300])
        return 1
    print(f"PUSHED commit {commit['sha'][:10]} to {OWNER}/{REPO} main ({len(files)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
