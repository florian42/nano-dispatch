#!/usr/bin/env bash
# One-time setup: point this repo's git at the versioned hooks under ./hooks/
# and verify that gitleaks is installed.
#
# Run from the repo root:
#     ./hooks/install.sh

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath hooks
chmod +x hooks/pre-commit hooks/pre-push

echo "✓ core.hooksPath set to 'hooks'"

if command -v gitleaks >/dev/null 2>&1; then
    echo "✓ gitleaks $(gitleaks version) found"
else
    cat >&2 <<'EOF'
⚠ gitleaks is not installed. The hooks will block all commits until you install it.

    brew install gitleaks            # macOS
    # see https://github.com/gitleaks/gitleaks for other platforms
EOF
    exit 1
fi

echo "Done. Hooks are active for this clone."
