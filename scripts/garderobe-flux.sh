#!/bin/bash
# Forced SSH command. Stdin: "<width> <height> <ext> [studio|cutout]\n<prompt>\n<image bytes>".
# v2 stdout: "GARDEROBE/2 <full length>\n", then full PNG and thumbnail PNG.
# Legacy requests without a mode still receive a single unprocessed PNG.
set -euo pipefail
umask 077
ulimit -c 0
runtime="$HOME/.local/libexec/garderobe-flux-runtime/Flux2CLI"
default_cli=/Applications/Flux2CLI
# Some standalone builds need mlx.metallib next to the executable. A user-local
# copy with that companion can be used without modifying the original install.
if [[ -x "$runtime" ]]; then default_cli="$runtime"; fi
cli=${FLUX2CLI_PATH:-$default_cli}
cutout=${GARDE_CUTOUT_PATH:-"$HOME/.local/libexec/garderobe-studio-cutout"}

IFS=' ' read -r width height ext mode
IFS= read -r prompt
case "$mode:$width:$height" in
	:768:1024|:1024:768|studio:768:1024|studio:1024:768)
		[[ -x "$cli" ]] || exit 69
		[[ ${#prompt} -le 2000 && "$prompt" == 'Professional e-commerce product photo '* ]] || exit 65 ;;
	cutout:0:0) [[ -z "$prompt" ]] || exit 65 ;;
	*) exit 65 ;;
esac
case "$mode:$ext" in
	*:jpg|*:png|*:webp|cutout:gif|cutout:avif) ;;
	*) exit 65 ;;
esac
[[ -z "$mode" || -x "$cutout" ]] || exit 73

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

run() {
	local status="$1"
	shift
	"$@" >&2 &
	pid=$!
	if ! wait "$pid"; then
		pid=
		exit "$status"
	fi
	pid=
}

render="$input"
if [[ "$mode" != cutout ]]; then
	render="$dir/output.png"
	# Klein 4B uses its default four steps. Do not inherit Cloudflare's step count.
	run 70 "$cli" i2i --model klein-4b --width "$width" --height "$height" --output "$render" "$prompt" --images "$input"
fi
if [[ -z "$mode" ]]; then
	/bin/cat "$render"
else
	run 74 "$cutout" "$render" "$dir/full.png" "$dir/thumb.png"
	printf 'GARDEROBE/2 %d\n' "$(/usr/bin/wc -c < "$dir/full.png")"
	/bin/cat "$dir/full.png" "$dir/thumb.png"
fi
