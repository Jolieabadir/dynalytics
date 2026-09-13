#!/usr/bin/env bash
#
# Generate synthetic clips for checking pose-extraction frame math.
#
# Two clips, identical in length and content but at different frame rates, so
# that fps detection and the row-count check have something unambiguous to be
# right or wrong about:
#
#   test_30fps.mp4 — 10s, 30fps, H.264  → expect ~300 rows
#   test_60fps.mp4 — 10s, 60fps, H.264  → expect ~600 rows
#
# Both carry a shape that moves every frame, so consecutive frames genuinely
# differ. A static clip would let a broken extractor that re-reads one frame
# still look correct.
#
# H.264 + yuv420p specifically: it is the format every target browser can
# decode, which keeps a failure here pointing at the extractor rather than at
# codec support.

set -euo pipefail

OUT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/test-videos}"
DURATION=10
SIZE=640x480

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Installing..."
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y ffmpeg
  else
    echo "error: install ffmpeg manually (no brew or apt-get found)." >&2
    exit 1
  fi
fi

mkdir -p "$OUT_DIR"

make_clip() {
  local fps="$1"
  local out="$OUT_DIR/test_${fps}fps.mp4"

  # testsrc2 animates on its own; the drawbox sweeps left to right across the
  # full duration so that no two frames are identical.
  ffmpeg -y -loglevel error \
    -f lavfi -i "testsrc2=size=${SIZE}:rate=${fps}:duration=${DURATION}" \
    -vf "drawbox=x='(iw-80)*t/${DURATION}':y='ih/2-40':w=80:h=80:color=red@0.9:t=fill" \
    -c:v libx264 -preset fast -pix_fmt yuv420p \
    -r "$fps" \
    "$out"

  local count
  count=$(ffprobe -v error -select_streams v:0 -count_frames \
    -show_entries stream=nb_read_frames -of csv=p=0 "$out")
  local rate
  rate=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=r_frame_rate -of csv=p=0 "$out")

  echo "  $out"
  echo "     frames=${count}  rate=${rate}  (expected ~$((fps * DURATION)))"
}

echo "Writing test clips to $OUT_DIR"
make_clip 30
make_clip 60

echo
echo "Done. Load one in the app and confirm:"
echo "  - detected fps matches the filename"
echo "  - row count is within a frame or two of duration x fps"
echo "  - frame_number is contiguous from 0"
