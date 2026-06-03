"""Quick verification that conclusion delete works end-to-end."""
import urllib.request, re, json

# Get token from dashboard
with urllib.request.urlopen("http://127.0.0.1:9119/") as r:
    html = r.read().decode()
m = re.search(r'HERMES_SESSION_TOKEN__="([^"]*)"', html)
token = m.group(1)
print(f"Token: {token[:20]}...")

# Get first conclusion
req = urllib.request.Request(
    "http://127.0.0.1:9119/api/plugins/honcho-dashboard/conclusions?limit=1",
    headers={"X-Hermes-Session-Token": token}
)
with urllib.request.urlopen(req) as r:
    data = json.loads(r.read())
    cid = data["items"][0]["id"]
    content = data["items"][0]["content"][:60]
    print(f"Deleting: {cid[:20]}... ({content}...)")

# Delete it
req = urllib.request.Request(
    f"http://127.0.0.1:9119/api/plugins/honcho-dashboard/conclusions/{cid}",
    method="DELETE",
    headers={"X-Hermes-Session-Token": token}
)
with urllib.request.urlopen(req) as r:
    resp = r.read().decode()
    print(f"Delete response: {r.status} {resp}")

# Verify it's gone
req = urllib.request.Request(
    "http://127.0.0.1:9119/api/plugins/honcho-dashboard/conclusions?limit=50",
    headers={"X-Hermes-Session-Token": token}
)
with urllib.request.urlopen(req) as r:
    data = json.loads(r.read())
    ids = [i["id"] for i in data.get("items", [])]
    print(f"Remaining: {len(ids)} conclusions")
    print(f"Deleted ID still in list: {cid in ids}")
    if cid not in ids:
        print("SUCCESS: Conclusion was deleted!")
    else:
        print("FAIL: Conclusion still in list")
