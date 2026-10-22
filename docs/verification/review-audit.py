"""Read-only dependency audit; no network requests or application keys."""
import json
import re
import subprocess
from pathlib import Path
sdk_families = re.compile(r'^(?:ai|@ai-sdk/.*|@aws-sdk/.*|@sentry/.*)$')
families = re.compile(r'^(?:ai|@ai-sdk/.*|@aws-sdk/.*|@sentry/.*|@opennextjs/cloudflare|wrangler)$')
additional = {'googleapis', 'google-auth-library', '@google/generative-ai', '@google/genai', 'resend', '@modelcontextprotocol/sdk'}
for folder in ('backend', 'frontend'):
    manifest = json.loads(Path(folder, 'package.json').read_text())
    lock = json.loads(Path(folder, 'package-lock.json').read_text())
    previous = json.loads(subprocess.check_output(['git', 'show', f'110b6b8:{folder}/package-lock.json']))
    def packages(data):
        return [key for key in data['packages'] if 'node_modules/' in key and (families.fullmatch(key.rsplit('node_modules/', 1)[1]) or key.rsplit('node_modules/', 1)[1] in additional)]
    def direct(data):
        return [name for category in ('dependencies', 'devDependencies') for name in data['packages'][''].get(category, {}) if families.fullmatch(name) or name in additional]
    assert all(lock['packages'][''].get(category, {}) == manifest.get(category, {}) for category in ('dependencies', 'devDependencies'))
    assert not packages(lock)
    assert not direct(lock)
    unique = lambda data, match: len({key.rsplit('node_modules/', 1)[1] for key in data['packages'] if 'node_modules/' in key and match.fullmatch(key.rsplit('node_modules/', 1)[1])})
    print(json.dumps({'unique_sdk_packages_before': unique(previous, sdk_families), 'unique_sdk_packages_after': unique(lock, sdk_families), 'package': folder, 'manifest_lock_match': True, 'removed_family_packages_before': len(packages(previous)), 'removed_family_packages_after': len(packages(lock)), 'removed_direct_dependencies_before': len(direct(previous)), 'removed_direct_dependencies_after': len(direct(lock))}))
