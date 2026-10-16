#!/usr/bin/env python3
"""Pin English counterparts for local Spanish scripts; never modify translations."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REPO = 'ArknightsAssets/ArknightsGamedata'

def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Arknights-VN-source-sync'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', default='master', help='Upstream commit or ref; resolved to a commit before downloading')
    args = parser.parse_args()
    revision = json.loads(fetch(f'https://api.github.com/repos/{REPO}/commits/{args.revision}'))['sha']
    spanish = ROOT / 'gamedata/es_ES/story'
    destination = ROOT / 'vn/sources/en'
    keys = sorted(path.relative_to(spanish).as_posix() for path in spanish.rglob('*.txt'))
    def download(key):
        return key, fetch(f'https://raw.githubusercontent.com/{REPO}/{revision}/en/gamedata/story/{key}')
    # Finish downloads before replacing a snapshot, so network failure cannot
    # leave a mixture of source revisions in the working tree.
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        scripts = dict(pool.map(download, keys))
    for key, data in scripts.items():
        target = destination / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    provenance = {'repository': REPO, 'revision': revision, 'files': {
        key.removesuffix('.txt'): hashlib.sha256(data).hexdigest() for key, data in scripts.items()
    }}
    (destination.parent / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Pinned {len(scripts)} English scripts at {revision}. Run build-catalog.mjs to validate and publish metadata.')

if __name__ == '__main__':
    main()
