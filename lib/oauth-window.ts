/**
 * Browser-side helper for opening a provider's OAuth consent screen in a
 * SEPARATE tab, so the operator's dashboard state survives in the original
 * one (filters, scroll position, unsaved panel state).
 *
 * WHY THE TAB IS OPENED BEFORE THE URL IS KNOWN
 * ---------------------------------------------
 * The authorization URL is minted by a Server Action, so it only exists
 * AFTER an `await`. By then the browser has consumed the click's user
 * activation and a bare `window.open(url, "_blank")` is silently swallowed
 * by the popup blocker — the button would simply do nothing.
 *
 * So the tab is claimed synchronously inside the click handler (while the
 * gesture is still live) and navigated once the URL arrives. This is the
 * standard pattern for popup/tab OAuth and is why `openOAuthTab()` takes no
 * arguments.
 *
 * SECURITY: `opener` is severed before navigating away from `about:blank`.
 * Without it the consent page would hold a live `window.opener` handle to
 * the dashboard and could navigate it elsewhere (reverse tabnabbing) — the
 * exact threat `rel="noopener noreferrer"` defends against on an anchor.
 */

export interface OAuthTab {
  /**
   * Point the reserved tab at `url`.
   *
   * @returns `false` when the browser refused the tab (popup blocker) or the
   * operator closed it before the URL arrived, so the caller can fall back.
   */
  navigate(url: string): boolean;
  /** Dispose of the reserved tab when authorization could not start. */
  close(): void;
}

/**
 * Reserve a new browser tab for an OAuth consent screen.
 *
 * MUST be called synchronously from the click handler — never after an
 * `await` — otherwise the popup blocker rejects it.
 */
export function openOAuthTab(): OAuthTab {
  const handle = typeof window === "undefined" ? null : window.open("", "_blank");

  if (handle) {
    try {
      // Sever the back-reference while the tab is still same-origin
      // (`about:blank`); once it navigates to the provider we can no longer
      // touch anything but its location.
      handle.opener = null;
    } catch {
      // Best effort: some embedded webviews make `opener` read-only. The
      // tab still works, it just keeps its (cross-origin, inert) handle.
    }
  }

  return {
    navigate(url: string): boolean {
      if (!handle || handle.closed) return false;
      // `replace` keeps `about:blank` out of the new tab's session history,
      // so "back" inside it cannot strand the operator on a blank page.
      handle.location.replace(url);
      handle.focus?.();
      return true;
    },
    close(): void {
      if (handle && !handle.closed) handle.close();
    },
  };
}
