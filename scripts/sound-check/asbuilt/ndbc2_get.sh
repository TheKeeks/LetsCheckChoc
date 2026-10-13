cd "$(dirname "$0")"
B=https://www.ndbc.noaa.gov/data/historical
for st in 44017 44025; do for y in 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025; do
  for pair in swden:w swdir:d swdir2:i swr1:j swr2:k stdmet:h; do
    t=${pair%%:*}; c=${pair##*:}; f=${st}${c}${y}.txt.gz
    [ -s $f ] && continue
    for i in 1 2 3; do curl -sS -f -m 120 -o $f "$B/$t/$f" && break; rm -f $f; sleep $((i*3)); done
  done
  echo "$st $y $(ls ${st}?${y}.txt.gz 2>/dev/null | wc -l)"
done; done
echo ALLDONE
