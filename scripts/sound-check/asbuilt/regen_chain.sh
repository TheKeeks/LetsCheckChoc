#!/bin/bash
# Everything the page builds from the ray tables, in the order of the 6 Oct rebuild. Expects fwd2_table_s1.json
# (and fr/, fr_page.json) in place.
set -euo pipefail
cd "$(dirname "$0")"
t0=$SECONDS
python3 valid_fwd2.py fwd2_table_s1.json write > regen_valid.log 2>&1      # hourly Choc / Wilderness heights since 2016
cp fwd2_table_s1.json fwd_table.json
python3 - <<'PY'
import json
for spot, names in (('choc', ('spec_choc.json', 'chocspec.json')), ('wild', ('spec_wild.json',))):
    a = json.load(open(f'fwd2spec_{spot}_s1.json')); b = {k: v[:2] for k, v in a.items()}
    for n in names: json.dump(b, open(n, 'w'))
PY
python3 analyze4.py > regen_analyze4.log 2>&1        # ten-year climatology, ratings model
python3 fwdk.py > /dev/null                          # forecast response + kernels for the trains
python3 mk_days2.py > /dev/null                      # calendar days
python3 trains.py > regen_trains.log 2>&1            # swell trains per day
python3 bend_days.py > /dev/null                     # share bent in from outside the window
python3 mk_wildstats.py > regen_wildstats.log && python3 mk_wildstats2.py > /dev/null && python3 mk_wildpeel.py > /dev/null   # Wilderness stats, days + peel
python3 sess_pairs.py > /dev/null                    # the size-vs-model chart
python3 fcscore.py > regen_fcscore.log 2>&1          # forecast scorecard (archived GFS-Wave from AWS)
echo "chain done in $((SECONDS - t0)) s"
