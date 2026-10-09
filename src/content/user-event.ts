/**
 * True only for input that came from the user. This runs inside arbitrary pages, whose scripts
 * can dispatch their own clicks on TypeTarget's badge buttons or on a field during selection
 * mode; those events have `isTrusted` false. Kept in its own module because jsdom never makes
 * a trusted event, so tests that click replace it (see session-badge.test.ts).
 */
export const isUserEvent = (event: Event): boolean => event.isTrusted;
