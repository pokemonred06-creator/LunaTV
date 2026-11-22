#!/bin/sh
set -eu
ssh synology 'd=/volume5/docker/.lunatv-episode-handoff-20261122; python3 "$d/rollout.py" rollback lunatv --root "$d"'
