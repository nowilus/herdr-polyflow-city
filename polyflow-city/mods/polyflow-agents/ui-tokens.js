// Shared office chrome as plain values, without host calls. Keep the existing font families;
// controls, fields, bubbles and headings use the agreed common scale, not a new visual brand.
export const SIGN_FONT = "Silkscreen"; // labels, buttons, badges
export const UI_FONT = "Chakra Petch"; // text and fields
export const LABEL_SIZE = 9;
export const SMALL_SIZE = 11;
export const BODY_SIZE = 12;
export const FIELD_SIZE = 13;
export const GAP = { tight: 2, small: 4, medium: 6, normal: 8, wide: 10 };
export const MONO_FONT = "JetBrains Mono";
export const RADIUS = Object.freeze({ control: 0, field: 4, bubble: 6, pill: 12 });
export const BUTTON = Object.freeze({ height: 24, padX: 8, size: 10 });
export const BAR_HEIGHT = 30;
export const TOOL_SIZE = 12;
export const TITLE_SIZE = 14;
export const FOCUS = Object.freeze({ width: 1, key: "accent" });
export const INK_ON_ACCENT = "#0b0d10";
// The battery is scene art too: keep its existing silhouette, not the NEWEST pill radius.
export const ENERGY_RADIUS = 5;
