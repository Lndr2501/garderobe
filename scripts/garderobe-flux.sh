#!/bin/bash
# Forced SSH command for Garderobe. Stdin: "<width> <height> <ext>\n<prompt>\n<image bytes>".
# Stdout must contain only the resulting PNG. All CLI output goes to stderr.
set -euo pipefail
umask 077
ulimit -c 0
runtime="$HOME/.local/libexec/garderobe-flux-runtime/Flux2CLI"
default_cli=/Applications/Flux2CLI
# Some standalone builds need mlx.metallib next to the executable. A user-local
# copy with that companion can be used without modifying the original install.
if [[ -x "$runtime" ]]; then default_cli="$runtime"; fi
cli=${FLUX2CLI_PATH:-$default_cli}
[[ -x "$cli" ]] || exit 69

IFS=' ' read -r width height ext
IFS= read -r prompt
case "$width:$height" in 768:1024|1024:768) ;; *) exit 65 ;; esac
case "$ext" in jpg|png|webp) ;; *) exit 65 ;; esac
[[ ${#prompt} -le 2000 && "$prompt" == 'Professional e-commerce product photo '* ]] || exit 65

dir=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/garderobe-flux.XXXXXXXX")
pid=
cleanup() {
	if [[ -n "$pid" ]]; then
		kill "$pid" 2>/dev/null || true
		wait "$pid" 2>/dev/null || true
	fi
	/bin/rm -rf -- "$dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

input="$dir/input.$ext"
max=$((12 * 1024 * 1024))
/usr/bin/head -c "$((max + 1))" > "$input"
bytes=$(/usr/bin/wc -c < "$input")
(( bytes > 0 && bytes <= max )) || exit 65

# Klein 4B uses its default four steps. Do not inherit Cloudflare's step count.
"$cli" i2i --model klein-4b --width "$width" --height "$height" --output "$dir/output.png" \
	"$prompt" --images "$input" >&2 &
pid=$!
if ! wait "$pid"; then
	pid=
	exit 70
fi
pid=
/bin/cat "$dir/output.png"
