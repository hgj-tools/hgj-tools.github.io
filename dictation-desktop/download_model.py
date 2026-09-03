# -*- coding: utf-8 -*-
"""הורדת מודל התמלול העברי של ivrit.ai (פורמט CTranslate2) עם אימות SHA256 מול Hugging Face.
רץ פעם אחת מתוך התקנה.bat. ללא תלויות חיצוניות."""
import os, sys, json, hashlib, urllib.request

REPO = "ivrit-ai/whisper-large-v3-turbo-ct2"
REVISION = "72ad623a3794"   # קומיט שנבדק ב-02.09.2026. שינוי גרסה = בדיקה מחדש לפי הנוהל
FILES = ["config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "README.md", "model.bin"]
DEST = os.path.join(os.environ["LOCALAPPDATA"], "HGJ", "dictation-desktop", "models", REPO.replace("/", "--"))


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(progress=None, dest=DEST):
    """מוריד את קבצי המודל שחסרים או פגומים. progress(pct, filename) נקרא תוך כדי.
    מאמת SHA256 מול Hugging Face לכל קובץ שיש לו חתימת LFS. מחזיר את תיקיית היעד."""
    os.makedirs(dest, exist_ok=True)
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{REPO}?blobs=true", timeout=60) as r:
        meta = json.load(r)
    expected = {}
    for s in meta.get("siblings", []):
        lfs = s.get("lfs") or {}
        expected[s["rfilename"]] = (lfs.get("sha256"), s.get("size"))
    for name in FILES:
        target = os.path.join(dest, name)
        want_sha, want_size = expected.get(name, (None, None))
        if os.path.exists(target) and want_size and os.path.getsize(target) == want_size:
            if not want_sha or sha256_of(target) == want_sha:
                continue
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
        tmp = target + ".part"
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
            done = 0
            while True:
                chunk = r.read(1 << 22)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if progress and want_size:
                    progress(min(100, done * 100 // want_size), name)
        if want_sha and sha256_of(tmp) != want_sha:
            os.remove(tmp)
            raise RuntimeError(f"SHA256 mismatch for {name}")
        os.replace(tmp, target)
    return dest


def main():
    def show(pct, name):
        print(f"\r  {name:26} {pct:3d}%", end="", flush=True)
    try:
        dest = download(show)
    except Exception as e:
        print(f"\n  ERROR: {e}")
        sys.exit(1)
    print("\nmodel ready:", dest)


if __name__ == "__main__":
    main()
