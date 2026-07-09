#!/bin/sh
set -e
# Railway (and Docker) mount the persistent volume over /data at RUNTIME, owned by
# root — which overrides the build-time chown. Ensure the unprivileged `app` user
# can write the SQLite DB + attachments before dropping privileges to it.
mkdir -p "${JUSTDOIT_FILES_DIR:-/data/files}"
chown -R app:app /data 2>/dev/null || true
exec gosu app "$@"
