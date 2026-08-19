// The only place the escaped brand character may appear (spec 1.4).
// Every user-visible rendering of the brand goes through BRAND_NAME so that
// technical sources stay pure ASCII while the user still reads the real name.
export const BRAND_NAME = "Aranj\u00E9";

/** ASCII identifier used for package name, routes, storage keys, files. */
export const BRAND_SLUG = "aranje";
