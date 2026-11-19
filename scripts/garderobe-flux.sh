#!/bin/bash
# Forced SSH command. Stdin: "<width> <height> <ext> [studio|studio-9b|cutout]\n<prompt>\n<image bytes>".
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
# Keep Garderobe models out of macOS's purgeable Library/Caches tree.
models_dir="${GARDE_MODELS_DIR:-$HOME/Library/Application Support/Garderobe/models}"
cutout=${GARDE_CUTOUT_PATH:-"$HOME/.local/libexec/garderobe-studio-cutout"}

IFS=' ' read -r width height ext mode
IFS= read -r prompt
case "$mode:$width:$height" in
	:768:1024|:1024:768|studio:768:1024|studio:1024:768|studio-9b:768:1024|studio-9b:1024:768)
		[[ -x "$cli" ]] || exit 69
		[[ ${#prompt} -le 2000 && "$prompt" == 'Professional e-commerce product photo '* ]] || exit 65 ;;
	tryon-9b:768:1024)
		[[ "$ext" == bundle && -x "$cli" && ${#prompt} -le 2000 && "$prompt" == 'Photorealistic virtual try-on.'* ]] || exit 65 ;;
	cutout:0:0) [[ -z "$prompt" ]] || exit 65 ;;
	*) exit 65 ;;
esac
case "$mode:$ext" in
	tryon-9b:bundle|*:jpg|*:png|*:webp|cutout:gif|cutout:avif) ;;
	*) exit 65 ;;
esac
[[ -z "$mode" || "$mode" == tryon-9b || -x "$cutout" ]] || exit 73

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

if [[ "$mode" == tryon-9b ]]; then
	# Fixed-size frame headers, no caller-supplied paths. Person is always first.
	/usr/bin/perl -e '
		use strict; use warnings;
		binmode STDIN;
		my @ext = qw(jpg png webp); my $n = 0;
		while (my $r = read(STDIN, my $header, 5)) {
			die unless $r == 5 && $n < 3;
			my ($fmt,$len) = unpack("CN", $header);
			die unless $fmt < 3 && $len > 0 && $len <= 12*1024*1024;
			open my $out, ">:raw", "$ARGV[0]/ref$n.$ext[$fmt]" or die;
			while ($len) { my $got = read(STDIN, my $buf, $len > 65536 ? 65536 : $len); die unless $got; print {$out} $buf or die; $len -= $got; }
			close $out or die; ++$n;
		}
		die unless $n >= 2;
	' "$dir" || exit 65
	refs=()
	for ref in "$dir"/ref*; do refs+=(--images "$ref"); done
	run 70 "$cli" i2i "$prompt" "${refs[@]}" --model klein-9b --transformer-quant int4 --text-quant 4bit --memory-profile conservative --steps 4 --guidance 1.0 --seed 42 --width "$width" --height "$height" --max-reference-megapixels 0.38 --models-dir "$models_dir" -o "$dir/output.png"
	/bin/cat "$dir/output.png"
	exit 0
fi
/usr/bin/head -c "$((max + 1))" > "$input"
bytes=$(/usr/bin/wc -c < "$input")
(( bytes > 0 && bytes <= max )) || exit 65

render="$input"
if [[ "$mode" != cutout ]]; then
	render="$dir/output.png"
	# Keep older servers on 4B, and use the tested 9B preset for the new request.
	model=klein-4b
	extra=()
	if [[ "$mode" == studio-9b ]]; then
		model=klein-9b
		extra=(--models-dir "$models_dir" --transformer-quant int4 --text-quant 4bit --memory-profile conservative --steps 4 --guidance 1.0 --seed 42)
	fi
	# Bash 3 set -u needs the conditional form when extra is empty.
	run 70 "$cli" i2i --model "$model" --width "$width" --height "$height" --output "$render" "$prompt" --images "$input" ${extra[@]+"${extra[@]}"}
fi
if [[ -z "$mode" ]]; then
	/bin/cat "$render"
else
	if [[ "$mode" == cutout ]]; then
		run 74 "$cutout" "$render" "$dir/full.png" "$dir/thumb.png"
	else
		run 74 "$cutout" "$render" "$dir/full.png" "$dir/thumb.png" --clean-edge
	fi
	printf 'GARDEROBE/2 %d\n' "$(/usr/bin/wc -c < "$dir/full.png")"
	/bin/cat "$dir/full.png" "$dir/thumb.png"
fi
