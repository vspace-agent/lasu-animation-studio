# 16-Frame Animation Sprite Sheet

Create one image containing exactly 16 sequential animation frames for later automatic slicing.

## 1. Canvas Geometry

* Canvas: `2048 × 2048 px`
* Grid: `4 × 4`
* Each frame: exactly `512 × 512 px`
* No gutters, borders, labels, numbers, or grid lines

Frame order is strictly left → right, top → bottom.

## 2. Exact Frame Coordinates

Use these exact cell boundaries:

* Frames 01–04: `y = 0–511`
* Frames 05–08: `y = 512–1023`
* Frames 09–12: `y = 1024–1535`
* Frames 13–16: `y = 1536–2047`

Columns:

* Column 1: `x = 0–511`
* Column 2: `x = 512–1023`
* Column 3: `x = 1024–1535`
* Column 4: `x = 1536–2047`

Every frame must be independently recoverable by exact 512 × 512 pixel cropping.

## 3. Locked Stage — CRITICAL

Treat every 512 × 512 frame as the **same fixed stage at a different moment in time**.

Create the background/environment once conceptually and reproduce it identically in all 16 frames.

Every static background element must occupy exactly the same **frame-local coordinates** in every frame.

Do not regenerate or reinterpret the background between frames.

No:

* camera movement
* reframing
* zoom
* perspective change
* parallax
* lighting variation

After slicing and overlaying the 16 frames, all static pixels should align as closely as possible.

## 4. Animated Layer

Only the intended animated subject or explicitly specified moving elements may change.

Keep the subject's reference position, scale, proportions, design, colors, perspective, and rendering style consistent unless a particular change is part of the animation.

Use a consistent local anchor point across frames.

Keep all artwork safely inside its frame boundaries.

## 5. Temporal Sequence

Frames 01 → 16 represent one continuous animation.

Motion must progress gradually and logically.

Adjacent frames should show small temporal changes rather than independently composed scenes.

Maintain continuity of shape, volume, orientation, lighting, and spatial relationships.

## 6. Animation Instruction

**Subject:** [SUBJECT]

**Fixed environment:** [BACKGROUND / STAGE]

**Movement:** [ANIMATION ACTION]

**Starting state — Frame 01:** [START]

**Midpoint — Frames 08–09:** [MIDPOINT]

**Ending state — Frame 16:** [END]

Priority order:

**exact grid geometry → locked background → spatial consistency → motion continuity → visual beauty**

Output one sprite-sheet image only.
