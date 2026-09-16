# Preserve layout when adding an interaction

Adding click or keyboard behavior to an existing row does not authorize a visual
redesign. Preserve its dimensions, spacing, and visual hierarchy unless the user
requests a presentation change. Shared action-button classes can add padding,
borders, and fills that are inappropriate for a row's interaction target.

Verify the actual hit target and rendered dimensions in a browser. Keyboard
activation tests alone cannot prove whole-row pointer coverage or preservation
of the existing layout. Keep adjacent actions independently reachable.
