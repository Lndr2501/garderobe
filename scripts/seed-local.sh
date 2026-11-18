#!/usr/bin/env bash
# Seeds a local dev server with sample items from e2e/.tmp/real/*.png pairs (full + thumb).
set -euo pipefail
U=${U:-http://localhost:5180}
PW=${PW:-lokal-test-1234}
J=$(mktemp)
curl -s -c "$J" -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" "$U/api/auth/setup" >/dev/null || true
curl -s -c "$J" -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" "$U/api/auth/login" >/dev/null
up() { curl -s -b "$J" -F "file=@$1;type=image/png" "$U/api/images" | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])'; }
mk() { # name category colors-json full thumb
	local f t; f=$(up "$4"); t=$(up "$5")
	curl -s -b "$J" -H 'Content-Type: application/json' -d "{\"name\":\"$1\",\"category\":\"$2\",\"colors\":$3,\"imageFront\":\"$f\",\"thumbFront\":\"$t\",\"warmth\":4,\"formality\":3}" "$U/api/items" >/dev/null
}
R=e2e/.tmp/real
mk "Schwarzer Half-Zip Pullover" top '["schwarz"]' $R/d143c6be-0496-4d22-8d99-d62d9bc6c57d.png $R/3bc81694-9a55-4053-ae19-6699eddec626.png
mk "Ralph Lauren Strickpullover" top '["navy"]' $R/fe940788-2730-4710-86f6-ff74371bfe7b.png $R/eb899993-2a64-4cd2-98d6-c3a371667790.png
mk "Half-Zip (Kopie)" top '["schwarz"]' $R/d143c6be-0496-4d22-8d99-d62d9bc6c57d.png $R/3bc81694-9a55-4053-ae19-6699eddec626.png
mk "Polo-Strick (Kopie)" top '["navy"]' $R/fe940788-2730-4710-86f6-ff74371bfe7b.png $R/eb899993-2a64-4cd2-98d6-c3a371667790.png
rm -f "$J"
echo seeded
