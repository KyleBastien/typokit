#!/usr/bin/env python3
"""Validate internal links in the built Starlight docs site.

Checks all internal <a href="..."> links in built HTML files to ensure
they resolve to existing pages. Exits with code 1 if broken links found.

Usage: python check-internal-links.py <dist-dir> <base-path>
Example: python check-internal-links.py packages/docs/dist /typokit
"""

import os
import re
import sys
from html.parser import HTMLParser

class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            for name, value in attrs:
                if name == 'href' and value:
                    self.links.append(value)

def get_built_paths(dist_dir):
    """Get all valid URL paths from the built site."""
    paths = set()
    for root, dirs, files in os.walk(dist_dir):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), dist_dir).replace('\\', '/')
            paths.add('/' + rel)
            # index.html also serves its directory path
            if f == 'index.html':
                dir_path = os.path.dirname(rel)
                if dir_path == '.':
                    paths.add('/')
                else:
                    paths.add('/' + dir_path + '/')
                    paths.add('/' + dir_path)
    return paths

def check_links(dist_dir, base_path):
    built_paths = get_built_paths(dist_dir)
    # Map base-prefixed paths too
    base_paths = set()
    for p in built_paths:
        base_paths.add(base_path + p if not p.startswith(base_path) else p)
        base_paths.add(p)

    broken = []
    checked = 0

    for root, dirs, files in os.walk(dist_dir):
        for f in files:
            if not f.endswith('.html'):
                continue
            filepath = os.path.join(root, f)
            rel_file = os.path.relpath(filepath, dist_dir).replace('\\', '/')

            # Skip auto-generated API reference readme page (known TypeDoc limitation)
            if 'api-reference/generated' in rel_file and '/readme/' in rel_file:
                continue

            with open(filepath, 'r', encoding='utf-8', errors='ignore') as fh:
                content = fh.read()

            parser = LinkExtractor()
            parser.feed(content)

            for link in parser.links:
                # Only check internal links
                if link.startswith('http://') or link.startswith('https://') or link.startswith('mailto:'):
                    continue
                if link.startswith('#'):
                    continue

                checked += 1
                # Strip fragment
                clean = link.split('#')[0]
                if not clean:
                    continue

                # Check if the link resolves
                if clean in base_paths:
                    continue

                # Try with/without trailing slash
                if (clean + '/') in base_paths or clean.rstrip('/') in base_paths:
                    continue

                # Map to file system path
                if clean.startswith(base_path):
                    fs_path = clean[len(base_path):]
                else:
                    fs_path = clean

                full_path = os.path.join(dist_dir, fs_path.lstrip('/'))
                if os.path.exists(full_path):
                    continue
                if os.path.exists(full_path + '/index.html'):
                    continue

                broken.append((rel_file, link))

    return checked, broken

if __name__ == '__main__':
    dist_dir = sys.argv[1] if len(sys.argv) > 1 else 'packages/docs/dist'
    base_path = sys.argv[2] if len(sys.argv) > 2 else '/typokit'

    checked, broken = check_links(dist_dir, base_path)
    print(f'Checked {checked} internal links')

    if broken:
        print(f'\n{len(broken)} broken internal links found:')
        for page, link in broken:
            print(f'  {link}')
            print(f'    in: {page}')
        sys.exit(1)
    else:
        print('All internal links are valid!')
        sys.exit(0)
