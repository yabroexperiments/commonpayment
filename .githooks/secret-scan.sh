#!/bin/sh
# ---------------------------------------------------------------------------
# secret-scan.sh — shared credential scanner.  (tracked at .githooks/)
#
#   ./secret-scan.sh <base-ref> <head-ref>    scan added lines in base..head
#   ./secret-scan.sh --tree <ref>             scan every tracked file at <ref>
#
# Exit 0 = clean, 1 = secrets found. Prints what it scanned either way: a
# silent pass is indistinguishable from a no-op.
#
# SINGLE SOURCE OF TRUTH for both enforcement points:
#   .githooks/pre-push                 (client-side, prevents the push)
#   .github/workflows/secret-scan.yml  (server-side, catches every client
#                                       incl. Codex Web / cloud / API pushes)
# Keeping one implementation means the two can never silently disagree.
# ---------------------------------------------------------------------------

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo .)
ALLOWLIST="$ROOT/.githooks/secret-allowlist.txt"

# High-confidence credential shapes. Deliberately provider-specific: a noisy
# guard gets bypassed and then protects nothing.
PATTERNS='(AKIA|ASIA)[0-9A-Z]{16}
gh[pousr]_[A-Za-z0-9]{36,}
github_pat_[A-Za-z0-9_]{60,}
sk-ant-[A-Za-z0-9_-]{20,}
sk-proj-[A-Za-z0-9_-]{20,}
sk-[A-Za-z0-9]{48}
(sk|rk)_live_[A-Za-z0-9]{20,}
whsec_[A-Za-z0-9]{20,}
AIza[0-9A-Za-z_-]{35}
GOCSPX-[A-Za-z0-9_-]{20,}
xox[abposr]-[A-Za-z0-9-]{10,}
SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}
npm_[A-Za-z0-9]{36}
sb_secret_[A-Za-z0-9_-]{20,}
re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{20,}
-----BEGIN [A-Z ]*PRIVATE KEY
eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}
cloudinary://[0-9]{6,}:[A-Za-z0-9_-]{10,}
[0-9]{8,10}:AA[A-Za-z0-9_-]{33}
(SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|PRIVATE_?KEY|SERVICE_ROLE(_KEY)?|CLIENT_SECRET|ADMIN_SECRET)[A-Z0-9_]*[[:space:]]*[=:][[:space:]]*.?[A-Za-z0-9_/+.!@#$%^&*-]{12,}'

# Never-secret shapes.
# NOTE: every line must be a COMPLETE standalone ERE. grep treats each line of
# a multi-line pattern as its own expression, so a line ending in "|" means
# "or empty" and matches EVERYTHING — silently disabling the whole guard while
# it still prints a cheerful check-mark. Caught by the test matrix 2026-08-06.
# Do not reintroduce a trailing pipe, and do not add a bare dictionary word.
BUILTIN_ALLOW='process\.env
import\.meta\.env
os\.environ
ENV\[
\$\{
\{\{
<[A-Za-z0-9_.-]+>
your[_-]?(api|key|token|secret|password)
placeholder
changeme
replace[_-]?(me|this|with)
xxxxx
EXAMPLEKEY
_EXAMPLE
EXAMPLE_
\.example
example\.(com|org|net)
[Rr][Ee][Dd][Aa][Cc][Tt][Ee][Dd]
\*\*\*\*
=[[:space:]]*$
:[[:space:]]*""
=""
(secret|token|key|password)[[:space:]]*[=:][[:space:]]*(process|await|config|opts|args|params|req|body|null|undefined|None|true|false)'

BAD_FILES='(^|/)\.env(\.[A-Za-z0-9_-]+)*$|(^|/)\.env\..*\.local$|\.pem$|\.p12$|\.pfx$|(^|/)id_(rsa|dsa|ecdsa|ed25519)$|(^|/)\.npmrc$|service-account.*\.json$|credentials\.json$'
OK_FILES='\.env\.example$|\.env\.sample$|\.env\.template$|\.env\..*\.example$'

found=0
label=""

filter_hits() {
    grep -vEi "$BUILTIN_ALLOW" | {
        if [ -f "$ALLOWLIST" ]; then grep -vE -f "$ALLOWLIST"; else cat; fi
    }
}

if [ "${1:-}" = "--tree" ]; then
    ref="${2:-HEAD}"
    label="full tree at $ref"
    files=$(git ls-tree -r --name-only "$ref")
    added=$(git grep -I -h -n -E "$PATTERNS" "$ref" -- . 2>/dev/null)
else
    base="$1"; head="$2"
    label="$base..$head"
    files=$(git diff --name-only --diff-filter=ACMR "$base" "$head" 2>/dev/null)
    added=$(git diff --unified=0 --diff-filter=ACMR "$base" "$head" 2>/dev/null \
            | grep -E '^\+' | grep -vE '^\+\+\+')
fi

nfiles=$(printf '%s\n' "$files" | grep -c . )

bad=$(printf '%s\n' "$files" | grep -E "$BAD_FILES" | grep -vE "$OK_FILES")
if [ -n "$bad" ]; then
    echo "✗ secret-scan: secret-bearing file(s):"
    printf '    %s\n' $bad
    found=1
fi

if [ -n "$added" ]; then
    hits=$(printf '%s\n' "$added" | grep -EIn "$PATTERNS" 2>/dev/null | filter_hits)
    if [ -n "$hits" ]; then
        echo "✗ secret-scan: credential-shaped string(s):"
        printf '%s\n' "$hits" | head -20 | cut -c1-160 | sed 's/^/    /'
        n=$(printf '%s\n' "$hits" | grep -c .)
        [ "$n" -gt 20 ] && echo "    ... and $((n - 20)) more"
        found=1
    fi
fi

if [ "$found" -ne 0 ]; then
    exit 1
fi
echo "✓ secret-scan: ${nfiles} file(s) scanned in ${label}, no secrets found"
exit 0
