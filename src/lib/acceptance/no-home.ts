/**
 * The way out of the editor that an acceptance route does not have
 * (2V-E.1 §8).
 *
 * The product's editor sits under a Home screen, and its title is the way
 * back to it. The `/eval/` routes are harnesses: they mount the real editor
 * on a fixed song inside their own page, with no library behind them and
 * nowhere to go. A no-op is the honest answer — better than inventing a Home
 * for a route that has none, and better than making the product's own way
 * home optional so a harness can leave it out.
 */
export const NO_HOME = (): void => {};
