/**
 * Google Analytics 4 measurement ID (`G-XXXXXXXXXX`) of the web stream for
 * https://app.zunialab.com.
 *
 * Empty means analytics is off entirely: no consent bar, no Settings switch,
 * no script, no request to Google. The ID is public (it ships in the page
 * once a visitor allows analytics), so it lives in source, not in env.
 *
 * TODO(main session): fill this in once the property's ID is known.
 */
export const GA_MEASUREMENT_ID = "";

/** The only host analytics may run on (never previews, localhost or mirrors). */
export const ANALYTICS_HOST = "app.zunialab.com";
