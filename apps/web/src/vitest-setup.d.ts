// Makes the jest-dom matcher augmentations (toBeInTheDocument, etc.) visible to
// svelte-check / tsc. The runtime registration happens in vitest-setup.ts; this
// ambient file (inside src/, so it's part of the TS program) loads the types.
import "@testing-library/jest-dom/vitest";
