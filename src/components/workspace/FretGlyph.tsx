import type { Articulation } from "@/lib/song/schema";

/**
 * The single way a fret number is drawn.
 *
 * Digits are monospaced and tabular, so 0, 3, 10 and 24 all sit on the same
 * centre and a chord lines up vertically. A small mask in the canvas colour
 * sits behind the digits so the string line stops at the number instead of
 * running through it. No pill, no button, no border.
 */
export function FretGlyph({
  fret,
  articulation,
}: {
  fret: number | null;
  articulation?: Articulation;
}) {
  const tone =
    articulation === "palm_mute"
      ? "text-text/70"
      : articulation === "accent"
        ? "text-text font-semibold"
        : "text-text";

  return (
    <span
      className={`bg-app font-mono text-[12px] leading-none tabular-nums ${tone}`}
      style={{ paddingInline: 3 }}
    >
      {fret ?? "?"}
    </span>
  );
}
