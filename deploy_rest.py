#!/usr/bin/env python3
"""Deploy Science Quest to Firebase without `firebase login`.

Uses the Google account already signed in to Cloud Shell (gcloud) and calls the
Firebase Hosting and Firebase Rules REST APIs directly:
  1. installs firestore.rules for the Firestore database
  2. uploads public/index.html as a new Hosting version and releases it
"""
import gzip, hashlib, json, os, subprocess, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = json.load(open(os.path.join(HERE, ".firebaserc")))["projects"]["default"]
SITE = PROJECT


def token():
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()


TOKEN = token()


def call(method, url, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("x-goog-user-project", PROJECT)
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode() or "{}"
            return json.loads(txt)
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        print("\nGAGAL / FAILED:", method, url.split("?")[0])
        print(msg[:800])
        if e.code in (401, 403):
            acct = subprocess.run(["gcloud", "config", "get-value", "account"], capture_output=True, text=True).stdout.strip()
            print("\nAkun Cloud Shell ini (" + acct + ") tidak punya izin ke proyek " + PROJECT + ".")
            print("This Cloud Shell account has no permission on the project.")
        sys.exit(1)


def deploy_rules():
    src = open(os.path.join(HERE, "firestore.rules")).read()
    rs = call("POST", f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/rulesets",
              {"source": {"files": [{"name": "firestore.rules", "content": src}]}})
    rel_name = f"projects/{PROJECT}/releases/cloud.firestore"
    body = {"name": rel_name, "rulesetName": rs["name"]}
    req = urllib.request.Request(f"https://firebaserules.googleapis.com/v1/{rel_name}", method="GET")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("x-goog-user-project", PROJECT)
    try:
        urllib.request.urlopen(req).read()
        call("PATCH", f"https://firebaserules.googleapis.com/v1/{rel_name}", {"release": body})
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(e.read().decode()[:500]); sys.exit(1)
        call("POST", f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/releases", body)
    print("OK  Aturan database terpasang (Firestore rules deployed)")


def deploy_hosting():
    base = "https://firebasehosting.googleapis.com/v1beta1"
    cfg = {"headers": [{"glob": "/index.html", "headers": {"Cache-Control": "no-cache"}}]}
    req = urllib.request.Request(f"{base}/projects/{PROJECT}/sites/{SITE}", method="GET")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("x-goog-user-project", PROJECT)
    try:
        urllib.request.urlopen(req).read()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(e.read().decode()[:500]); sys.exit(1)
        call("POST", f"{base}/projects/{PROJECT}/sites?siteId={SITE}", {})  # create the default site
    ver = call("POST", f"{base}/sites/{SITE}/versions", {"config": cfg})
    vname = ver["name"]
    content = gzip.compress(open(os.path.join(HERE, "public", "index.html"), "rb").read())
    h = hashlib.sha256(content).hexdigest()
    pop = call("POST", f"{base}/{vname}:populateFiles", {"files": {"/index.html": h}})
    if h in pop.get("uploadRequiredHashes", []):
        call("POST", pop["uploadUrl"] + "/" + h, raw=content, ctype="application/octet-stream")
    call("PATCH", f"{base}/{vname}?update_mask=status", {"status": "FINALIZED"})
    call("POST", f"{base}/sites/{SITE}/releases?versionName={vname}", {})
    print("OK  Aplikasi terunggah (Hosting deployed)")


if __name__ == "__main__":
    deploy_rules()
    deploy_hosting()
    print("\nDeploy complete!")
    print("Hosting URL: https://" + SITE + ".web.app")
